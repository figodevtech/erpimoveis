import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  NFSeService,
  listarPendenciasNFSe,
  type NFSeModeloEmissao,
} from "@/lib/services/fiscais/nfse-service";
import {
  dataDoDiaNFSe,
  itensListaDosServicos,
  resolverContextoEmissaoNFSe,
  rotuloPoliticaNFSe,
} from "@/lib/services/fiscais/nfse-politica";
import { transportDaPolitica } from "@/lib/services/fiscais/nfse-transport";
import { grupoOsNFSe, validarGrupoOsNFSe, SelecaoNFSeError, type OrdemSelecaoNFSe } from "@/lib/services/fiscais/nfse-selecao";
import { notaDoServicoNFSe } from "@/lib/services/fiscais/nfse-nota-servico";
import type { ClienteResumo, CodigosFiscaisForm, DescontoOrigemNfse } from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/types";
import { CAMPOS_ALVO_OS, carregarAlvoDaOs, type OrdemComAlvo } from "@/services/fiscal/alvoDaOs";
import { distribuirDinheiro, particionarDescontoDaOs } from "@/lib/nfe/descontoOrigem";
import { inferirDescontoGeralOs } from "@/lib/ordens/totais";
import { comporObservacoesComGarantia } from "@/lib/fiscal/garantiaObservacoes";

export const runtime = "nodejs";

function toNumber(value: unknown) {
  const numero = Number(value);
  return Number.isFinite(numero) ? numero : 0;
}

type RouteParams = {
  params: Promise<{ id: string }>;
};

type OrdemListagemNFSe = OrdemSelecaoNFSe & OrdemComAlvo & {
  cliente?: ClienteResumo | null;
  observacoes_fiscais?: string | null;
  garantia?: string | null;
  subtotal?: number | null;
  orcamentototal?: number | null;
  valor_frete?: number | null;
  osproduto?: Array<{ quantidade: number; precounitario: number; subtotal: number }>;
};

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const osId = Number(id);

    if (!Number.isInteger(osId) || osId <= 0) {
      return NextResponse.json(
        { ok: false, message: "ID da OS inválido." },
        { status: 400 }
      );
    }

    const adicionais = req.nextUrl.searchParams.get("osIdsAdicionais");
    const osIds = grupoOsNFSe(osId, adicionais ? adicionais.split(",") : []);
    const { data: ordens, error } = await supabaseAdmin
      .from("ordemservico")
      .select(`
        id,
        observacoes_fiscais,
        garantia,
        subtotal,
        orcamentototal,
        valor_frete,
        ${CAMPOS_ALVO_OS},
        cliente (*),
        osproduto (quantidade, precounitario, subtotal),
        osservico (
          *,
          servico (*)
        )
      `)
      .in("id", osIds)
      .returns<OrdemListagemNFSe[]>();

    if (error || !ordens) {
      console.error("[GET /api/nfse/servicos-de-os] Erro Supabase:", error);
      return NextResponse.json(
        { ok: false, message: "Erro ao buscar serviços da OS.", error: error?.message },
        { status: 404 }
      );
    }

    const grupo = validarGrupoOsNFSe(osIds, ordens);
    const os = grupo[0];
    const colunasNotas = "id, ordemservicoid, referencia, status, erros, modelo_emissao, servico_ids, itens";
    const [diretas, vinculadas] = await Promise.all([
      supabaseAdmin.from("nfse").select(colunasNotas).in("ordemservicoid", osIds),
      supabaseAdmin.from("nfse_os_servico_vinculo")
        .select("nfse_id, ordemservico_id, servico_id, ativo").in("ordemservico_id", osIds),
    ]);
    if (diretas.error) throw diretas.error;
    if (vinculadas.error) throw vinculadas.error;
    const vinculos = vinculadas.data ?? [];
    const idsDiretas = new Set((diretas.data ?? []).map((nota) => Number(nota.id)));
    const idsVinculadas = [...new Set(vinculos.map((v) => Number(v.nfse_id)))].filter((id) => !idsDiretas.has(id));
    const outrasNotas = idsVinculadas.length
      ? await supabaseAdmin.from("nfse").select(colunasNotas).in("id", idsVinculadas)
      : { data: [], error: null };
    if (outrasNotas.error) throw outrasNotas.error;
    const notas = [...(diretas.data ?? []), ...(outrasNotas.data ?? [])];

    const { data: empresa, error: empresaError } = await supabaseAdmin
      .from("empresa")
      .select("id, cnpj, inscricaomunicipal, codigomunicipio, regimetributario")
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (empresaError) throw empresaError;
    const codigoMunicipio = String(empresa?.codigomunicipio ?? "").replace(/\D/g, "");

    // Fixar `1` aqui fazia o padrão sumir em banco cuja empresa tem outro id, e
    // a emissão abria sem código nenhum preenchido.
    const { data: nfseConfig, error: configError } = await supabaseAdmin
      .from("nfse_config")
      .select("padroes_emissao, incluir_garantia_os")
      .eq("empresa_id", empresa?.id ?? 1)
      .maybeSingle();

    if (configError) throw configError;
    const padroesEmissao = (nfseConfig?.padroes_emissao ?? {}) as Partial<
      Record<NFSeModeloEmissao, Partial<CodigosFiscaisForm>>
    >;

    // Visão da OS inteira, só para o cabeçalho e as pendências da listagem. O
    // modelo e o padrão que preenchem a revisão vêm de `contexto-emissao`, com
    // os serviços efetivamente selecionados — uma OS que mistura item comum e
    // exceção de João Pessoa muda de emissor conforme a seleção.
    const contexto = resolverContextoEmissaoNFSe({
      empresa,
      itensListaServico: itensListaDosServicos(grupo.flatMap((ordem) => Array.isArray(ordem.osservico) ? ordem.osservico : [])),
      dataCompetencia: dataDoDiaNFSe(new Date()),
      padroesEmissao,
    });
    const politica = contexto?.politica ?? null;
    const modeloEmissao: NFSeModeloEmissao | null = contexto?.modeloEmissao ?? null;
    const padraoFiscal = contexto?.padraoFiscal ?? null;

    // O desconto geral da OS é rateado entre peças e mão de obra: a NF-e leva a
    // fatia dos produtos, esta NFS-e leva a dos serviços. Mesma partição e mesmos
    // pesos da rota `produtos-para-nfe`, para os dois diálogos mostrarem o mesmo
    // número. Aqui é só informativo: o valor enviado continua sendo o digitado.
    const descontosPorOs: DescontoOrigemNfse[] = [];
    const servicosMapeados = grupo.flatMap((os) => {
      const itensServico = (Array.isArray(os.osservico) ? os.osservico : []) as any[];
      const brutoPorServico = itensServico.map(
        (item) => toNumber(item.quantidade) * toNumber(item.precounitario),
      );
      const liquidoPorServico = itensServico.map((item, index) => {
        const liquido = toNumber(item.subtotal);
        return liquido > 0 ? Math.min(liquido, brutoPorServico[index]) : brutoPorServico[index];
      });
      const itensProduto = (Array.isArray(os.osproduto) ? os.osproduto : []) as any[];
      const liquidoPorProduto = itensProduto.map((item) => {
        const bruto = toNumber(item.quantidade) * toNumber(item.precounitario);
        const liquido = toNumber(item.subtotal);
        return liquido > 0 ? Math.min(liquido, bruto) : bruto;
      });
      // Peso do serviço é o subtotal gravado, cru — o mesmo que a rota de produtos
      // usa do outro lado da conta.
      const pesosDosServicos = itensServico.map((item) => toNumber(item.subtotal));
      const descontoGeral = inferirDescontoGeralOs({
        subtotal: os.subtotal,
        orcamentoTotal: os.orcamentototal,
        valorFrete: os.valor_frete,
      });
      const particao = particionarDescontoDaOs(descontoGeral, liquidoPorProduto, pesosDosServicos);
      // Fecha exatamente com `particao.servicos`: a sobra de centavos vai no último.
      const rateioPorServico = distribuirDinheiro(particao.servicos, pesosDosServicos);

      // Mescla os dados
      descontosPorOs.push(particao);
      return itensServico.map((item: any, index: number) => {
        const { nota: notaGerada, item: itemEmitido } = notaDoServicoNFSe(Number(os.id), Number(item.servicoid), notas, vinculos);

        const descontoItem = Number(
          Math.max(0, brutoPorServico[index] - liquidoPorServico[index]).toFixed(2),
        );
        const descontoRateado = rateioPorServico[index] ?? 0;

        return {
          ...item,
          ordemservicoid: Number(os.id),
          descontoItem,
          descontoRateado,
          valorLiquidoSugerido: Number(
            Math.max(0, liquidoPorServico[index] - descontoRateado).toFixed(2),
          ),
          pendenciasCadastro: modeloEmissao
            ? listarPendenciasNFSe(os, empresa, item, modeloEmissao)
            : [{ origem: "EMPRESA" as const, mensagem: "município da empresa sem modelo de NFS-e configurado" }],
          notaFiscalStatus: notaGerada ? notaGerada.status : null,
          notaFiscalId: notaGerada ? notaGerada.id : null,
          notaFiscalErros: notaGerada ? notaGerada.erros : null,
          notaFiscalModelo: notaGerada ? notaGerada.modelo_emissao : null,
          notaFiscalReferencia: notaGerada ? notaGerada.referencia : null,
          notaFiscalValor: itemEmitido ? Number(itemEmitido.valor) : null,
        };
      });

    });
    const particao = descontosPorOs.reduce((total, desconto) => ({
      total: total.total + desconto.total,
      produtos: total.produtos + desconto.produtos,
      servicos: total.servicos + desconto.servicos,
      baseProdutos: total.baseProdutos + desconto.baseProdutos,
      baseServicos: total.baseServicos + desconto.baseServicos,
    }), { total: 0, produtos: 0, servicos: 0, baseProdutos: 0, baseServicos: 0 });

    // O dialog de emissão mostra e edita o cadastro do tomador sem sair da tela.
    // Só os campos que entram na nota — o resto do cadastro fica com o dialog do
    // cliente, que busca por conta própria.
    const clienteOS = os.cliente as any;

    return NextResponse.json({
      ok: true,
      osIds,
      servicos: servicosMapeados,
      modeloEmissao,
      // O que a tela precisa da política além do modelo: se o grupo da Reforma
      // é obrigatório e o porquê do emissor escolhido.
      politicaEmissao: politica && empresa
        ? {
            exigeRtc: politica.exigeRtc,
            motivo: politica.motivo,
            regimeTributario: String(empresa.regimetributario ?? ""),
            layout: politica.layout,
            autorizador: politica.autorizador,
            rotulo: rotuloPoliticaNFSe(politica),
            // Sem integração com o autorizador, a tela mostra o motivo e não
            // deixa emitir — a rota de emissão recusa do mesmo jeito.
            bloqueio: transportDaPolitica(politica, new NFSeService()).motivoIndisponivel,
          }
        : null,
      codigoMunicipio,
      padraoFiscal,
      padraoAusente: Boolean(contexto?.padraoAusente),
      // A observação da OS continua vencendo o padrão do modelo, como antes.
      // A garantia é acrescentada sobre o texto que efetivamente abriria no
      // campo, sem fazer o padrão municipal/nacional desaparecer.
      observacoesFiscais: comporObservacoesComGarantia({
        observacoes:
          String(os.observacoes_fiscais ?? "").trim()
          || padraoFiscal?.informacoesComplementares,
        garantia: os.garantia,
        incluir: Boolean(nfseConfig?.incluir_garantia_os),
      }) || null,
      // Alvo do reparo, para o botão que injeta os dados dele no texto livre.
      alvo: await carregarAlvoDaOs(os),
      // Null quando a OS não tem desconto geral: a tela não ganha painel nenhum.
      descontoOrigem: particao.total > 0 ? particao : null,
      cliente: clienteOS
        ? {
            id: Number(clienteOS.id),
            nomerazaosocial: clienteOS.nomerazaosocial ?? null,
            tipopessoa: clienteOS.tipopessoa ?? null,
            cpfcnpj: clienteOS.cpfcnpj ?? null,
            email: clienteOS.email ?? null,
            telefone: clienteOS.telefone ?? null,
            endereco: clienteOS.endereco ?? null,
            endereconumero: clienteOS.endereconumero ?? null,
            enderecocomplemento: clienteOS.enderecocomplemento ?? null,
            bairro: clienteOS.bairro ?? null,
            cidade: clienteOS.cidade ?? null,
            estado: clienteOS.estado ?? null,
            cep: clienteOS.cep ?? null,
            codigomunicipio: clienteOS.codigomunicipio ?? null,
            inscricaomunicipal: clienteOS.inscricaomunicipal ?? null,
          }
        : null,
    });
  } catch (e: any) {
    if (e instanceof SelecaoNFSeError) {
      return NextResponse.json({ ok: false, message: e.message }, { status: e.status });
    }
    console.error("[GET /api/nfse/servicos-de-os]", e);
    return NextResponse.json({ ok: false, message: "Erro inesperado." }, { status: 500 });
  }
}
