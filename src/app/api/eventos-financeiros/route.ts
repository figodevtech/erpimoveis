export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireFinanceiroCreate, requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  comCriadoPor,
  criarEventoDaOs,
  idValido,
  responder,
  responderFalha,
} from "@/app/api/ordens/[id]/eventos-financeiros/_lib/servico";

/**
 * Todos os eventos financeiros de OS num lugar só.
 *
 * A recepção lança despesa na OS o dia inteiro; quem transforma isso em título
 * no a pagar é o financeiro. Sem esta lista, o único caminho até um evento era
 * abrir a OS — e o que ninguém abria, ninguém lançava: a despesa ficava só no
 * evento, fora do caixa, e reaparecia na DRE sem contrapartida.
 *
 * Por isso o filtro nasce em `NAO_LANCADO`. A tela é uma fila de trabalho antes
 * de ser um relatório.
 */

const FORTALEZA_OFFSET = "-03:00";

function localDayStartToUtcIso(dateStr: string) {
  return new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`).toISOString();
}

function localNextDayStartToUtcIso(dateStr: string) {
  const day = new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`);
  return new Date(day.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

const EVENTO_FIELDS =
  "id, ordemservicoid, origem, natureza, natureza_dre, status, descricao, detalhe, valor, "
  + "data_evento, competencia_em, produtoid, servicoid, chave_origem, dados_snapshot, is_manual, "
  + "created_by, pode_gerar_transacao, transacaoid, lancamento_id, consumo_saida_id, "
  + "consumo_usoconsumo_saida_id, quantidade_snapshot";

const ORDEM_FIELDS =
  "ordem:ordemservicoid!inner ( id, status, is_deleted, dataentrada, "
  + "cliente:clienteid ( id, nomerazaosocial ) )";

const ORDENAVEIS = new Set(["data_evento", "valor", "ordemservicoid", "id"]);

const SITUACOES = new Set(["NAO_LANCADO", "LANCADO", "TODOS"]);

const ORIGENS = new Set([
  "PRODUTO", "SERVICO", "COMISSAO", "AVULSO", "DESCONTO", "FRETE", "CONSUMO", "ENTRADA_FISCAL",
]);

/**
 * O recorte de cada situação, aplicado igual na lista e nos totais.
 *
 * "Não lançado" é a tripla que o resto do sistema já usa — `registrar_lancamento_
 * de_eventos` valida exatamente isto antes de converter. `pode_gerar_transacao`
 * fica dentro dela porque custo de produto e desconto nunca viram transação:
 * mostrá-los na fila do financeiro seria pendência que não existe.
 */
function aplicarSituacao<T extends { eq: any; is: any; neq: any }>(query: T, situacao: string): T {
  if (situacao === "NAO_LANCADO") {
    return query
      .eq("status", "ATIVO")
      .eq("pode_gerar_transacao", true)
      .is("transacaoid", null)
      .is("lancamento_id", null);
  }
  if (situacao === "LANCADO") return query.eq("status", "CONVERTIDO");
  return query.neq("status", "CANCELADO");
}

/** Os filtros que valem para a lista e para os totais. Um lugar só, para os dois não divergirem. */
function aplicarFiltros(query: any, f: ReturnType<typeof lerFiltros>) {
  let q = aplicarSituacao(query, f.situacao)
    // `source_type` só existe desde 20260802160000 e é nulo em linha antiga; a
    // presença da OS é o teste que vale para todo o histórico.
    .not("ordemservicoid", "is", null)
    .eq("ordem.is_deleted", false);

  if (f.natureza) q = q.eq("natureza", f.natureza);
  if (f.origem) q = q.eq("origem", f.origem);
  if (f.osId) q = q.eq("ordemservicoid", f.osId);
  if (f.clienteId) q = q.eq("ordem.clienteid", f.clienteId);
  if (f.dateFrom) q = q.gte("data_evento", localDayStartToUtcIso(f.dateFrom));
  if (f.dateTo) q = q.lt("data_evento", localNextDayStartToUtcIso(f.dateTo));
  if (f.buscaEm) q = q.or(f.buscaEm);
  return q;
}

function lerFiltros(searchParams: URLSearchParams) {
  const situacaoBruta = String(searchParams.get("situacao") ?? "").toUpperCase();
  const situacao = SITUACOES.has(situacaoBruta) ? situacaoBruta : "NAO_LANCADO";

  const naturezaBruta = String(searchParams.get("natureza") ?? "").toUpperCase();
  const natureza = ["RECEITA", "DESPESA"].includes(naturezaBruta) ? naturezaBruta : "";

  const origemBruta = String(searchParams.get("origem") ?? "").toUpperCase();
  const origem = ORIGENS.has(origemBruta) ? origemBruta : "";

  const search = (searchParams.get("search") ?? searchParams.get("q") ?? "").trim().slice(0, 200);
  // `#123` procura a OS, não o texto: é como o operador se refere a uma ordem, e
  // digitá-lo na busca livre não acharia nada.
  const osDaBusca = /^#?\d+$/.test(search) ? Number(search.replace("#", "")) : null;
  const escapado = search.replace(/[%,()]/g, " ").trim();
  const buscaEm = escapado
    ? [
        `descricao.ilike.%${escapado}%`,
        `detalhe.ilike.%${escapado}%`,
        ...(osDaBusca ? [`ordemservicoid.eq.${osDaBusca}`] : []),
      ].join(",")
    : "";

  return {
    situacao,
    natureza,
    origem,
    osId: idValido(searchParams.get("osId")),
    clienteId: idValido(searchParams.get("clienteId")),
    dateFrom: (searchParams.get("dateFrom") ?? "").trim(),
    dateTo: (searchParams.get("dateTo") ?? "").trim(),
    search,
    buscaEm,
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireFinanceirosAccess();
    const { searchParams } = new URL(req.url);

    const page = Math.max(Number(searchParams.get("page") ?? 1) || 1, 1);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 50) || 50, 1), 200);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const ordenarBruto = String(searchParams.get("ordenarPor") ?? "");
    const ordenarPor = ORDENAVEIS.has(ordenarBruto) ? ordenarBruto : "data_evento";
    const ascending = String(searchParams.get("ordem") ?? "desc").toLowerCase() === "asc";

    const filtros = lerFiltros(searchParams);

    const query = aplicarFiltros(
      supabaseAdmin
        .from("eventos_financeiros")
        .select(`${EVENTO_FIELDS}, ${ORDEM_FIELDS}`, { count: "exact" }),
      filtros,
    )
      // A OS entra na ordenação sempre: as linhas são lidas agrupadas por ordem,
      // e sem isso duas despesas da mesma OS cairiam separadas na página.
      .order("ordemservicoid", { ascending: false })
      .order(ordenarPor, { ascending })
      .order("id", { ascending: true })
      .range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    const eventos = await comCriadoPor(data ?? []);

    // Os totais valem para o filtro inteiro, não para a página: o financeiro abre
    // a tela para saber quanto falta lançar, e o número da página responderia
    // outra pergunta. Vem sem `range` e só com as colunas da soma.
    const { data: paraTotais, error: totaisError } = await aplicarFiltros(
      // Os filtros de OS exigem que `ordem` seja um recurso embutido no
      // PostgREST, ainda que seus campos não participem da soma.
      supabaseAdmin
        .from("eventos_financeiros")
        .select("natureza, valor, ordemservicoid, ordem:ordemservicoid!inner ( id )"),
      filtros,
    );
    if (totaisError) throw totaisError;

    const linhas = paraTotais ?? [];
    const somar = (natureza: string) =>
      Math.round(
        linhas
          .filter((linha: any) => linha.natureza === natureza)
          .reduce((soma: number, linha: any) => soma + Number(linha.valor ?? 0), 0) * 100,
      ) / 100;
    const receita = somar("RECEITA");
    const despesa = somar("DESPESA");

    return NextResponse.json({
      data: eventos,
      pagination: {
        total: count ?? 0,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / limit)),
      },
      totais: {
        receita,
        despesa,
        liquido: Math.round((receita - despesa) * 100) / 100,
        quantidade: linhas.length,
        ordens: new Set(linhas.map((linha: any) => linha.ordemservicoid)).size,
      },
      filters: filtros,
    });
  } catch (error: any) {
    return responderFalha(error, "Erro ao listar eventos financeiros.");
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFinanceiroCreate();
    const body = await req.json().catch(() => ({}));
    const osId = idValido(body?.ordemServicoId);
    if (!osId) {
      return responder({ ok: false, error: "Informe a ordem de serviço do lançamento.", status: 400 });
    }

    const session = await auth();
    const usuarioId = (session?.user as any)?.id ?? null;
    return responder(await criarEventoDaOs(osId, body, usuarioId), 201);
  } catch (error: any) {
    return responderFalha(error, "Erro ao criar evento financeiro.");
  }
}
