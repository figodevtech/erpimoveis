import { z } from "zod";

const FORTALEZA_OFFSET = "-03:00";

const SITUACOES = new Set(["NAO_LANCADO", "LANCADO", "TODOS"]);

const ORIGENS = new Set([
  "PRODUTO",
  "SERVICO",
  "COMISSAO",
  "AVULSO",
  "DESCONTO",
  "FRETE",
  "CONSUMO",
  "ENTRADA_FISCAL",
]);

function idPositivo(valor: unknown) {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function localDayStartToUtcIso(dateStr: string) {
  return new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`).toISOString();
}

function localNextDayStartToUtcIso(dateStr: string) {
  const day = new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`);
  return new Date(day.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function usuarioIdValido(valor: string | null) {
  const usuarioId = String(valor ?? "").trim();
  if (!usuarioId) return "";
  if (!z.string().uuid().safeParse(usuarioId).success) {
    const error = new Error("O usuário informado é inválido.");
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }
  return usuarioId;
}

export function lerFiltrosDeEventos(searchParams: URLSearchParams) {
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
    osId: idPositivo(searchParams.get("osId")),
    clienteId: idPositivo(searchParams.get("clienteId")),
    usuarioId: usuarioIdValido(searchParams.get("usuarioId")),
    dateFrom: (searchParams.get("dateFrom") ?? "").trim(),
    dateTo: (searchParams.get("dateTo") ?? "").trim(),
    search,
    buscaEm,
    agruparPorOs: searchParams.get("agruparPorOs") !== "0",
    selecionarTodos: searchParams.get("selecionaveis") === "1",
  };
}

export type FiltrosDeEventosApi = ReturnType<typeof lerFiltrosDeEventos>;

/** O recorte de cada situação, aplicado igual na lista, nos totais e na seleção. */
function aplicarSituacao<T extends { eq: any; is: any; neq: any }>(
  query: T,
  situacao: string,
): T {
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

/** Os filtros comuns. `ordem` precisa estar embutida na consulta recebida. */
export function aplicarFiltrosDeEventos(query: any, filtros: FiltrosDeEventosApi) {
  let q = aplicarSituacao(query, filtros.situacao)
    // `source_type` é nulo em parte do histórico; a presença da OS é a
    // identificação retrocompatível dos eventos desta tela.
    .not("ordemservicoid", "is", null)
    .eq("ordem.is_deleted", false);

  if (filtros.natureza) q = q.eq("natureza", filtros.natureza);
  if (filtros.origem) q = q.eq("origem", filtros.origem);
  if (filtros.osId) q = q.eq("ordemservicoid", filtros.osId);
  if (filtros.clienteId) q = q.eq("ordem.clienteid", filtros.clienteId);
  if (filtros.usuarioId) q = q.eq("usuarioid", filtros.usuarioId);
  if (filtros.dateFrom) q = q.gte("data_evento", localDayStartToUtcIso(filtros.dateFrom));
  if (filtros.dateTo) q = q.lt("data_evento", localNextDayStartToUtcIso(filtros.dateTo));
  if (filtros.buscaEm) q = q.or(filtros.buscaEm);
  return q;
}

/**
 * Restringe qualquer uma das três situações às despesas que ainda podem ser
 * reunidas num pagamento. Em `LANCADO` as condições são incompatíveis de
 * propósito e a seleção volta vazia.
 */
export function aplicarElegibilidadeDePagamento(query: any) {
  return query
    .eq("natureza", "DESPESA")
    .eq("status", "ATIVO")
    .eq("pode_gerar_transacao", true)
    .is("transacaoid", null)
    .is("lancamento_id", null);
}
