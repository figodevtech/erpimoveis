// app/api/entradas/nf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PERMS, requireAny } from "@/app/api/_authz/perms";
import { extrairCobranca } from "@/lib/nfe/duplicatas";
import { identificarEmitente } from "@/lib/nfe/identificacao-emitente";
import { lerNFeDoXml, lerItensDaNota, lerTotaisDaNota } from "@/lib/nfe/totais-nfe";
import { componentesDoItem, componentesNaoAlocados } from "@/lib/nfe/valor-fiscal-entrada";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

async function salvarXmlRecebidoManual(xml: string, parsed: any, raw: any) {
  const chave = String(parsed.chaveAcesso ?? "").replace(/\D/g, "");
  if (chave.length !== 44) throw new Error("Não foi possível identificar a chave de acesso do XML.");

  const { data: empresa, error: empresaError } = await supabaseAdmin
    .from("empresa")
    .select("id")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (empresaError) throw empresaError;
  if (!empresa?.id) throw new Error("Cadastre a empresa antes de importar uma NF-e.");

  const { data: existente, error: existenteError } = await supabaseAdmin
    .from("fiscal_dfe_documento")
    .select("id, nsu")
    .eq("empresa_id", empresa.id)
    .eq("chave_acesso", chave)
    .or("schema.like.resNFe%,schema.like.procNFe%")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existenteError) throw existenteError;

  const protocolo = raw?.nfeProc?.protNFe?.infProt ?? {};
  const documento = {
    schema: "procNFe_manual_v4.00",
    tipo_documento: "PROC_NFE",
    chave_acesso: chave,
    data_emissao: parsed.dataEmissao,
    emitente_nome: parsed.emitente?.nome,
    // A coluna conserva o nome histórico, mas nas consultas ela representa o
    // documento fiscal do emitente e também precisa guardar CPF.
    emitente_cnpj:
      String(
        parsed.emitente?.documento ??
          parsed.emitente?.cnpj ??
          parsed.emitente?.cpf ??
          "",
      ).replace(/\D/g, "") || null,
    valor_total: parsed.totais?.valorNota,
    status: protocolo.cStat ? String(protocolo.cStat) : null,
    xml,
    resumo: {
      origem: "IMPORTACAO_MANUAL",
      xmlCompleto: true,
      numeroNota: parsed.numeroNota,
      serie: parsed.serie,
      protocolo: protocolo.nProt ? String(protocolo.nProt) : null,
    },
    updatedat: new Date().toISOString(),
  };

  if (existente?.id) {
    const { data, error } = await supabaseAdmin
      .from("fiscal_dfe_documento")
      .update(documento)
      .eq("id", existente.id)
      .select("id")
      .single();
    if (error) throw error;
    return Number(data.id);
  }

  const { data, error } = await supabaseAdmin
    .from("fiscal_dfe_documento")
    .insert({
      ...documento,
      empresa_id: empresa.id,
      nsu: `MANUAL:${chave}`,
    })
    .select("id")
    .single();
  if (error) throw error;
  return Number(data.id);
}

export async function POST(req: NextRequest) {
  try {
    await requireAny([PERMS.ESTOQUE_CRIAR, PERMS.USOCONSUMO_ENTRADA]);
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "Nenhum arquivo enviado" },
        { status: 400 }
      );
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "O XML não pode ultrapassar 10 MB." }, { status: 400 });
    }

    // Lê o conteúdo do arquivo
    const arrayBuffer = await file.arrayBuffer();
    const xml = Buffer.from(arrayBuffer).toString("utf-8");

    // Converte XML → JS Object e acha o infNFe (nfeProc, NFe avulso ou recorte).
    const { documento, infNFe: raizNFe } = lerNFeDoXml(xml);
    const json = documento as any;

    if (!raizNFe) {
      return NextResponse.json(
        { error: "Estrutura de NF-e não reconhecida" },
        { status: 400 }
      );
    }

    const infNFe = raizNFe as any;

    // Agora extraímos as principais variáveis/“campos”
    const ide = infNFe.ide || {};
    const emit = infNFe.emit || {};
    const dest = infNFe.dest || {};
    const identificacaoEmitente = identificarEmitente(emit);
    // A cobrança é o parcelamento que o fornecedor já emitiu. Sem ela, a tela de
    // entrada pedia para digitar de novo o que estava no XML.
    const cobranca = extrairCobranca(infNFe);
    /*
     * A leitura fiscal: o que compõe o `vNF` e o que é só informativo.
     *
     * `vNF` continua sendo o valor da nota — a composição serve para saber de
     * quais acréscimos ele é feito e para acusar divergência, nunca para
     * substituir o número que o emitente declarou.
     */
    const composicao = lerTotaisDaNota(infNFe);
    const itensFiscais = lerItensDaNota(infNFe);
    /*
     * Os componentes fiscais viajam com o item, já classificados.
     *
     * A tela precisa saber que o ICMS-Só do item 2 compõe o `vNF` e a qual item
     * pertence. Recalcular isso do outro lado, com uma segunda lista de campos,
     * era como as duas metades do sistema divergiam.
     */
    const naoAlocados = componentesNaoAlocados(composicao);

    const result = {
      // Chave de acesso
      chaveAcesso:
        infNFe["@_Id"]?.replace("NFe", "") ||
        String(json.nfeProc?.protNFe?.infProt?.chNFe ?? "") ||
        null,

      // Dados básicos
      numeroNota: ide.nNF || null,
      serie: ide.serie || null,
      dataEmissao: ide.dhEmi || ide.dEmi || null,
      tipoOperacao: ide.tpNF, // 0=Entrada, 1=Saída

      // Emitente
      emitente: {
        ...identificacaoEmitente,
        nome: emit.xNome || null,
        nomeFantasia: emit.xFant || null,
        ie: emit.IE || null,
        endereco: {
          logradouro: emit.enderEmit?.xLgr || null,
          numero: emit.enderEmit?.nro || null,
          codigoMunicipio: emit.enderEmit?.cMun || null,
          bairro: emit.enderEmit?.xBairro || null,
          municipio: emit.enderEmit?.xMun || null,
          uf: emit.enderEmit?.UF || null,
          cep: emit.enderEmit?.CEP || null,
        },
      },

      // Destinatário
      destinatario: {
        cnpj: dest.CNPJ || null,
        cpf: dest.CPF || null,
        nome: dest.xNome || null,
        ie: dest.IE || null,
        endereco: {
          logradouro: dest.enderDest?.xLgr || null,
          numero: dest.enderDest?.nro || null,
          bairro: dest.enderDest?.xBairro || null,
          municipio: dest.enderDest?.xMun || null,
          uf: dest.enderDest?.UF || null,
          cep: dest.enderDest?.CEP || null,
        },
      },

      // Totais. As seis chaves antigas continuam onde estavam; `composicao` é a
      // leitura fiscal inteira, com reconciliação contra o `vNF`.
      totais: {
        valorProdutos: composicao.produtos,
        valorNota: composicao.totalNota,
        valorFrete: composicao.acrescimos.frete,
        valorDesconto: composicao.reducoes.desconto,
        valorICMS: composicao.informativos.icms,
        valorIPI: composicao.acrescimos.ipi,
        composicao,
      },

      // Cobrança (grupo `cobr`): fatura e duplicatas, quando a nota é a prazo.
      fatura: cobranca.fatura,
      duplicatas: cobranca.duplicatas,

      // Itens da nota. Os valores por item existem para conferir a composição e
      // para o custo da linha — nunca para somar de novo o que já veio no total.
      itens: itensFiscais.map((item) => ({
        numeroItem: item.numeroItem,
        codigo: item.codigo,
        ean: item.ean,
        descricao: item.descricao,
        ncm: item.ncm,
        cest: item.cest,
        cfop: item.cfop,
        unidade: item.unidade,
        quantidade: item.quantidade,
        valorUnitario: item.valorUnitario,
        valorTotal: item.valorProdutos,
        compoeTotal: item.compoeTotal,
        valorDesconto: item.valorDesconto,
        valorFrete: item.valorFrete,
        valorSeguro: item.valorSeguro,
        outrasDespesas: item.outrasDespesas,
        valorIpi: item.valorIpi,
        valorIpiDevolvido: item.valorIpiDevolvido,
        valorIcmsST: item.valorIcmsST,
        valorFcpST: item.valorFcpST,
        valorIcmsMonoReten: item.valorIcmsMonoReten,
        valorII: item.valorII,
        valorIcmsDesonerado: item.valorIcmsDesonerado,
        deduzIcmsDesonerado: item.deduzIcmsDesonerado,
        pisST: item.pisST,
        cofinsST: item.cofinsST,
        valorTotalTributos: item.informativos.totalTributos,
        componentesFiscais: componentesDoItem(item, composicao),
        icms: item.icms,
      })),

      // Componentes que o total declara e nenhum <det> informou. Continuam
      // fazendo parte do valor fiscal da nota: são rateados na entrada, não
      // descartados.
      componentesNaoAlocados: naoAlocados,
    };

    const documentoFiscalRecebidoId = await salvarXmlRecebidoManual(xml, result, json);

    return NextResponse.json({
      raw: json,
      parsed: { ...result, documentoFiscalRecebidoId },
    });
  } catch (err: any) {
    console.error(err);
    const informedStatus = Number(err?.statusCode);
    const status = informedStatus === 401 || informedStatus === 403 ? informedStatus : 500;
    return NextResponse.json(
      { error: "Erro ao processar a nota", detail: err?.message },
      { status }
    );
  }
}
