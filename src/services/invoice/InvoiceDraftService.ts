import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CreateInvoiceDTO, InvoiceDraftResult } from "./invoice.types";
import { buildNFePreviewXml } from "@/lib/nfe/buildNFe";
import { EmpresaRow, NFeDestinatario } from "@/lib/nfe/types";
import { resolverNomeMunicipioIbge } from "@/lib/ibge/municipio";

export class InvoiceDraftService {
  async createDraft(dto: CreateInvoiceDTO): Promise<InvoiceDraftResult> {
    // 1. Validar Empresa e Config
    const { data: empresa, error: empError } = await supabaseAdmin
      .from("empresa")
      .select("*")
      .eq("id", dto.empresaId)
      .single<EmpresaRow>();

    if (empError || !empresa) {
      throw new Error(`Empresa ${dto.empresaId} não encontrada.`);
    }
    const nomeMunicipioEmitente = await resolverNomeMunicipioIbge(
      empresa.codigomunicipio,
      empresa.uf
    );

    const { data: config, error: cfgError } = await supabaseAdmin
      .from("nfe_config")
      .select("*")
      .eq("empresaid", dto.empresaId)
      .single();

    if (cfgError || !config) {
      throw new Error(`Configuração de NFe não encontrada para empresa ${dto.empresaId}.`);
    }

    // 2. Calcular próximo número
    const nextNumber = (config.ultimo_numero || 0) + 1;
    const serie = config.serie || 1;
    const ambiente = config.ambiente || "HOMOLOGACAO";
    // 3. Inserir Header na tabela NFE
    // Agora suportamos fornecedorid e entradaid
    const insertPayload: any = {
        empresaid: dto.empresaId,
        modelo: config.modelo || "NFE",
        serie: serie,
        numero: nextNumber,
        ambiente: ambiente,
        status: 'RASCUNHO',
        dataemissao: new Date().toISOString(),
        total_produtos: 0, // Será atualizado
        total_nfe: 0,      // Será atualizado
        
        // Campos de origem
        vendaid: dto.origem?.vendaId ?? null,
        ordemservicoid: dto.origem?.osId ?? null,
        entradaid: dto.origem?.entradaId ?? null,

        // Parceiro - Lógica de exclusão mútua definida no banco, mas aqui garantimos
        clienteid: dto.parceiro.tipo === 'CLIENTE' ? dto.parceiro.id : null,
        fornecedorid: dto.parceiro.tipo === 'FORNECEDOR' ? dto.parceiro.id : null,
        
        // Chave de acesso temporária (será gerada no XML)
        chave_acesso: 'PENDENTE_' + Date.now(), 
        cfop: dto.itens[0]?.cfop ?? null // Pega do primeiro item como referência
    };

    const { data: nfeInserted, error: insertError } = await supabaseAdmin
        .from('nfe')
        .insert(insertPayload)
        .select('id')
        .single();
    
    if (insertError) {
        throw new Error(`Erro ao criar registro de NFe: ${insertError.message}`);
    }

    const nfeId = nfeInserted.id;

    // 4. Atualizar numeração na config
    await supabaseAdmin
        .from('nfe_config')
        .update({ ultimo_numero: nextNumber, updatedat: new Date().toISOString() })
        .eq('id', config.id);


    // 5. Inserir Itens
    let totalProdutos = 0;
    let totalNFe = 0; // Somar produtos + impostos se necessário, mas simplificando: sum(vProd)
    // OBS: A lógica de impostos totais deve considerar vICMS, vST, vFrete etc.
    // Por enquanto vamos somar valorTotal dos itens.

    const itemsToInsert = dto.itens.map((item, index) => {
        totalProdutos += item.valorTotal;
        return {
            nfe_id: nfeId,
            n_item: index + 1,
            produtoid: (item.codigoProduto && !isNaN(Number(item.codigoProduto))) ? Number(item.codigoProduto) : null,
            descricao: item.descricao,
            ncm: item.ncm,
            cfop: item.cfop,
            unidade: item.unidade,
            quantidade: item.quantidade,
            valor_unitario: item.valorUnitario,
            valor_total: item.valorTotal,
            
            // Taxas / Impostos
            csosn: item.csosn,
            cst: item.cst, // NFeItem tem cst e cstIcms, ver mapping
            cest: null, // Se tiver no DTO, mapear
            
            aliquotaicms: item.aliquotaIcms,
            valor_bc_icms: item.baseCalculoIcms,
            valor_icms: item.valorIcms,

            cst_pis: item.cstPis,
            aliquota_pis: item.aliquotaPis,
            valor_pis: item.valorPis,

            cst_cofins: item.cstCofins,
            aliquota_cofins: item.aliquotaCofins,
            valor_cofins: item.valorCofins
        };
    });

    totalNFe = totalProdutos; // Simplificação inicial

    if (itemsToInsert.length > 0) {
        const { error: itemsError } = await supabaseAdmin
            .from('nfe_item')
            .insert(itemsToInsert);
        
        if (itemsError) {
            console.error("Erro ao inserir itens:", itemsError);
            // Poderíamos fazer rollback (delete nfeId), mas por enquanto throw
            throw new Error(`Erro ao inserir itens da NFe: ${itemsError.message}`);
        }
    }

    // 6. Atualizar totais na NFe
    await supabaseAdmin
        .from('nfe')
        .update({ 
            total_produtos: totalProdutos,
            total_nfe: totalNFe,
            updatedat: new Date().toISOString()
        })
        .eq('id', nfeId);

    // 7. Gerar XML de Rascunho (Preview)
    // Precisamos adaptar o parceiro para NFeDestinatario
    // Se for Entrada Própria (emitente = destinatário) ou Entrada de Fornecedor (emitente = empresa, destinatário = fornecedor? Nao)
    // REGRA DE ENTRADA: 
    // Emissão Própria (ex: Importação): Emitente = Empresa, Destinatário = Empresa (ou fornecedor no exterior? mas SEFAZ pede dados br)
    // Compra de Produtor/Devolução de Cliente: Emitente = Empresa, Destinatário = Fornecedor/Cliente (Remetente)
    // O buildNFePreviewXml atual assume Saída (Empresa = Emitente, Cliente = Destinatário).
    
    // Para ENTRADA (tpNF=0), a lógica inverte ou muda campos.
    // Vamos construir o destinatário com os dados do parceiro.
    
    const destinatario = this.mapPartnerToDestinatario(dto.parceiro);

    // TODO: buildNFePreviewXml precisa aceitar tpNF no futuro. Por enquanto ele força tpNF=1 (saída) hardcoded ou pega da config?
    // Verificando buildNFePreviewXml... ele usa tpNF fixo ou não? 
    // Vamos chamar e ver. Se precisar ajustar, ajustamos o helper.
    
    try {
        const { xml, chave } = buildNFePreviewXml(
            empresa,
            nextNumber,
            serie,
            dto.itens,
            destinatario,
            {
                tpNF: dto.tipoOperacao === '1' ? 1 : 0,
                natOp: dto.naturezaOperacao || 'VENDA DE MERCADORIA',
                nomeMunicipioEmitente
            }
        );

        // Atualizar com XML e Chave real
        await supabaseAdmin
            .from('nfe')
            .update({ 
                xml_assinado: xml,
                chave_acesso: chave
            })
            .eq('id', nfeId);
            
        return {
            nfeId,
            chaveAcesso: chave,
            message: "Rascunho criado com sucesso"
        };
    } catch (err: any) {
        console.error("Erro ao gerar XML preview:", err);
        // Não falha o processo todo, deixa o rascunho sem XML
        return {
            nfeId,
            message: "Rascunho criado (sem XML): " + err.message
        };
    }
  }

  private mapPartnerToDestinatario(partner: CreateInvoiceDTO['parceiro']): NFeDestinatario {
    // Mapeamento simples
    return {
        cnpj: partner.documento.length > 11 ? partner.documento : undefined,
        cpf: partner.documento.length <= 11 ? partner.documento : undefined,
        razaoSocial: partner.razaoSocial,
        // Se for ISENTO ou não tiver IE, tratar. 
        indIEDest: partner.inscricaoEstadual ? "1" : "9", 
        inscricaoEstadual: partner.inscricaoEstadual,
        endereco: {
            logradouro: partner.endereco.logradouro,
            numero: partner.endereco.numero,
            complemento: partner.endereco.complemento,
            bairro: partner.endereco.bairro,
            codigoMunicipio: partner.endereco.codigoMunicipio,
            nomeMunicipio: partner.endereco.cidade,
            uf: partner.endereco.uf,
            cep: partner.endereco.cep,
            codigoPais: partner.endereco.codPais || "1058",
            nomePais: partner.endereco.pais || "BRASIL",
            telefone: partner.telefone
        }
    };
  }
}
