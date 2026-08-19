export const runtime = "nodejs";

import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { requireRelatoriosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Relatorio de movimentacao de estoque.
 *
 * Uma linha por movimento de item — nao por documento. Produtos saem do razao
 * (`estoque_movimento_financeiro_historico`), que ja resolve status derivado,
 * marca fiscal e autor. Uso e consumo nao tem razao: a linha por item e montada
 * aqui a partir de `usoconsumo_entrada_item` e `usoconsumo_saida_item`, que
 * guardam saldo_anterior/saldo_resultante do mesmo jeito.
 *
 * VALOR: o custo vem do cadastro do item no momento da geracao —
 * `ultimovalordecompra`, caindo para `precocompra` —, e nao do custo congelado
 * em cada documento. Decisao do dono da operacao. Duas consequencias que o
 * cabecalho da planilha declara: o mesmo periodo reimpresso depois de uma compra
 * nova sai com outro valor, e este numero nao bate com o CMV da DRE, que usa o
 * custo historico do documento. Por isso a coluna se chama "Custo atual", nunca
 * "CMV".
 */

const LOCAL_OFFSET = "-03:00";
const PAGE_SIZE = 1000;
/** Teto de seguranca: relatorio de oficina nao chega perto disso. */
const MAX_LINHAS = 20000;

const SENTIDOS = new Set(["ENTRADA", "SAIDA"]);
const ACOES = new Set(["REGISTRO", "ESTORNO"]);
const STATUS = new Set(["CONFIRMADA", "CANCELADA"]);
const ORIGENS = new Set([
  "ENTRADA",
  "SAIDA_MANUAL",
  "VENDA",
  "ORDEM_SERVICO",
  "NAO_IDENTIFICADA",
]);

const ROTULO_ORIGEM: Record<string, string> = {
  ENTRADA: "Entrada",
  SAIDA_MANUAL: "Saída manual",
  VENDA: "Venda",
  ORDEM_SERVICO: "Ordem de serviço",
  NAO_IDENTIFICADA: "Sem origem",
};

/** Linha achatada, comum aos dois estoques, pronta para virar celula. */
type Linha = {
  data: string;
  movimento: string;
  sentido: "ENTRADA" | "SAIDA";
  origem: string;
  acao: string;
  documento: string;
  status: string;
  item: string;
  quantidade: number;
  saldoAnterior: number | null;
  saldoResultante: number | null;
  /** Não vai para a planilha sozinho: é o que multiplica a quantidade. */
  custoUnitario: number;
  parte: string;
  responsavel: string;
};

function texto(value: string | null, limite = 100) {
  return (value ?? "").trim().slice(0, limite).replace(/[%_]/g, "");
}

function inteiro(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function inicioDoDia(value: string) {
  return new Date(`${value}T00:00:00${LOCAL_OFFSET}`).toISOString();
}

function diaSeguinte(value: string) {
  return new Date(new Date(`${value}T00:00:00${LOCAL_OFFSET}`).getTime() + 86_400_000).toISOString();
}

function formatarData(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

/**
 * Rotulo legivel a partir de um valor de enum: sem sublinhado e com uma unica
 * inicial maiuscula. Sem isso a planilha mistura "CONFIRMADA" e
 * "COMPRA_FORNECEDOR" com "Ordem de serviço" na mesma coluna.
 */
function rotular(value: string | null | undefined) {
  const limpo = (value ?? "").trim().replaceAll("_", " ").toLocaleLowerCase("pt-BR");
  return limpo ? limpo.charAt(0).toLocaleUpperCase("pt-BR") + limpo.slice(1) : "";
}

/** Primeiro nao-vazio, ja aparado. */
function primeiro(...valores: (string | null | undefined)[]) {
  for (const valor of valores) {
    const limpo = (valor ?? "").trim();
    if (limpo) return limpo;
  }
  return "";
}

/** Custo do cadastro: ultimo valor de compra e, na falta dele, o medio. */
function custoDoCadastro(item: { ultimovalordecompra?: unknown; precocompra?: unknown } | undefined) {
  const ultimo = Number(item?.ultimovalordecompra ?? 0);
  if (Number.isFinite(ultimo) && ultimo > 0) return ultimo;
  const medio = Number(item?.precocompra ?? 0);
  return Number.isFinite(medio) && medio > 0 ? medio : 0;
}

/** Percorre uma consulta paginada ate o fim ou ate o teto de linhas. */
async function coletar<T>(
  build: () => any,
  aplicarFaixa: (query: any, de: number, ate: number) => any = (query, de, ate) => query.range(de, ate),
) {
  const linhas: T[] = [];
  for (let de = 0; de < MAX_LINHAS; de += PAGE_SIZE) {
    const { data, error } = await aplicarFaixa(build(), de, de + PAGE_SIZE - 1);
    if (error) throw error;
    const lote = (data ?? []) as T[];
    linhas.push(...lote);
    if (lote.length < PAGE_SIZE) break;
  }
  return linhas;
}

/** Busca em lote por id, sem depender de relacionamento declarado no PostgREST. */
async function mapaPorId(tabela: string, colunas: string, ids: (number | string)[]) {
  const unicos = [...new Set(ids.filter((id) => id !== null && id !== undefined && id !== ""))];
  const mapa = new Map<string, any>();
  for (let de = 0; de < unicos.length; de += PAGE_SIZE) {
    const fatia = unicos.slice(de, de + PAGE_SIZE);
    if (!fatia.length) continue;
    const { data, error } = await supabaseAdmin.from(tabela).select(colunas).in("id", fatia);
    if (error) throw error;
    for (const registro of (data ?? []) as any[]) mapa.set(String(registro.id), registro);
  }
  return mapa;
}

/** Razao de produtos: a view ja entrega tudo achatado. */
async function linhasDeProdutos(params: URLSearchParams): Promise<Linha[]> {
  const dateFrom = texto(params.get("dateFrom"), 10);
  const dateTo = texto(params.get("dateTo"), 10);
  const sentido = (params.get("sentido") ?? "").toUpperCase();
  const origem = (params.get("origem") ?? "").toUpperCase();
  const acao = (params.get("acao") ?? "").toUpperCase();
  const status = (params.get("status") ?? "").toUpperCase();
  const fiscal = (params.get("fiscal") ?? "").toLowerCase();
  const produtoId = inteiro(params.get("produtoId"));

  const build = () => {
    let query = supabaseAdmin
      .from("estoque_movimento_financeiro_historico")
      .select("*")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (dateFrom) query = query.gte("created_at", inicioDoDia(dateFrom));
    if (dateTo) query = query.lt("created_at", diaSeguinte(dateTo));
    if (SENTIDOS.has(sentido)) query = query.eq("sentido", sentido);
    if (ORIGENS.has(origem)) query = query.eq("origem", origem);
    if (ACOES.has(acao)) query = query.eq("acao", acao);
    if (STATUS.has(status)) query = query.eq("status", status);
    if (fiscal === "com_nf") query = query.eq("fiscal", true);
    if (fiscal === "sem_nf") query = query.eq("fiscal", false);
    if (produtoId) query = query.eq("produto_id", produtoId);
    return query;
  };

  const movimentos = await coletar<any>(build);
  const custos = await mapaPorId(
    "produto",
    "id, ultimovalordecompra, precocompra",
    movimentos.map((movimento) => movimento.produto_id).filter(Boolean),
  );

  return movimentos.map((movimento) => {
    const nota = texto(movimento.entrada_numero_nota, 30);
    return {
      data: movimento.created_at,
      movimento: `#${movimento.id}`,
      sentido: movimento.sentido === "ENTRADA" ? "ENTRADA" : "SAIDA",
      origem: ROTULO_ORIGEM[movimento.origem] ?? rotular(movimento.origem),
      acao: movimento.acao === "ESTORNO" ? "Estorno" : "Registro",
      documento: primeiro(
        [movimento.documento_label, nota ? `NF ${nota}` : ""].filter(Boolean).join(" · "),
        ROTULO_ORIGEM[movimento.origem],
      ),
      status: rotular(movimento.status) || "Confirmada",
      item: primeiro(movimento.produto_titulo, `Produto #${movimento.produto_id}`),
      quantidade: Number(movimento.quantidade ?? 0),
      saldoAnterior: movimento.saldo_anterior ?? null,
      saldoResultante: movimento.saldo_resultante ?? null,
      custoUnitario: custoDoCadastro(custos.get(String(movimento.produto_id))),
      parte: primeiro(movimento.fornecedor_nome, movimento.saida_motivo ? rotular(movimento.saida_motivo) : ""),
      responsavel: primeiro(movimento.criador_nome),
    };
  });
}

/**
 * Uso e consumo: sem razao proprio, a linha por item nasce do cruzamento dos
 * cabecalhos filtrados com seus itens. Os cabecalhos vem primeiro justamente
 * para o periodo e o status filtrarem antes de qualquer juncao.
 */
async function linhasDeUsoConsumo(params: URLSearchParams): Promise<Linha[]> {
  const dateFrom = texto(params.get("dateFrom"), 10);
  const dateTo = texto(params.get("dateTo"), 10);
  const sentido = (params.get("sentido") ?? "").toUpperCase();
  const status = (params.get("status") ?? "").toUpperCase();
  const fiscal = (params.get("fiscal") ?? "").toLowerCase();

  const periodo = (query: any) => {
    let atual = query;
    if (dateFrom) atual = atual.gte("created_at", inicioDoDia(dateFrom));
    if (dateTo) atual = atual.lt("created_at", diaSeguinte(dateTo));
    if (STATUS.has(status)) atual = atual.eq("status", status);
    return atual;
  };

  const querEntradas = !SENTIDOS.has(sentido) || sentido === "ENTRADA";
  const querSaidas = !SENTIDOS.has(sentido) || sentido === "SAIDA";
  // Saida de uso e consumo nunca e fiscal: pedir "somente com NF" a exclui.
  const saidasPermitidas = querSaidas && fiscal !== "com_nf";

  const entradas = querEntradas
    ? await coletar<any>(() =>
        periodo(
          supabaseAdmin
            .from("usoconsumo_entrada")
            .select("id, created_at, status, tipo, origem, fiscal, numero_nota, fornecedor_id, created_by")
            .order("created_at", { ascending: true }),
        ),
      )
    : [];

  const saidas = saidasPermitidas
    ? await coletar<any>(() =>
        periodo(
          supabaseAdmin
            .from("usoconsumo_saida")
            .select("id, created_at, status, motivo, setor, funcionario, centro_custo_id, created_by")
            .order("created_at", { ascending: true }),
        ),
      )
    : [];

  // A marca fiscal segue a mesma regra da view do historico: bandeira, numero de
  // nota ou origem de NF-e. Aplicada aqui porque nao existe coluna unica para
  // filtrar no banco.
  const entradaEhFiscal = (entrada: any) =>
    entrada.fiscal === true ||
    Boolean(texto(entrada.numero_nota, 30)) ||
    entrada.origem === "NFE_TERCEIRO";
  const entradasFiltradas = entradas.filter((entrada) => {
    if (fiscal === "com_nf") return entradaEhFiscal(entrada);
    if (fiscal === "sem_nf") return !entradaEhFiscal(entrada);
    return true;
  });

  const itensDeEntrada = entradasFiltradas.length
    ? await coletar<any>(
        () =>
          supabaseAdmin
            .from("usoconsumo_entrada_item")
            .select("id, entrada_id, item_id, quantidade, saldo_anterior, saldo_resultante, titulo")
            .in("entrada_id", entradasFiltradas.map((entrada) => entrada.id))
            .order("id", { ascending: true }),
      )
    : [];

  const itensDeSaida = saidas.length
    ? await coletar<any>(
        () =>
          supabaseAdmin
            .from("usoconsumo_saida_item")
            .select("id, saida_id, item_id, quantidade, saldo_anterior, saldo_resultante")
            .in("saida_id", saidas.map((saida) => saida.id))
            .order("id", { ascending: true }),
      )
    : [];

  const itens = await mapaPorId(
    "usoconsumo_item",
    "id, titulo, ultimovalordecompra, precocompra",
    [...itensDeEntrada, ...itensDeSaida].map((linha) => linha.item_id),
  );
  const fornecedores = await mapaPorId(
    "fornecedor",
    "id, nomerazaosocial",
    entradasFiltradas.map((entrada) => entrada.fornecedor_id).filter(Boolean),
  );
  const centros = await mapaPorId(
    "centrosdecusto",
    "id, nome",
    saidas.map((saida) => saida.centro_custo_id).filter(Boolean),
  );
  const usuarios = await mapaPorId(
    "usuario",
    "id, nome",
    [...entradasFiltradas, ...saidas].map((cabecalho) => cabecalho.created_by).filter(Boolean),
  );

  const porEntrada = new Map(entradasFiltradas.map((entrada) => [String(entrada.id), entrada]));
  const porSaida = new Map(saidas.map((saida) => [String(saida.id), saida]));

  const linhas: Linha[] = [];

  for (const linha of itensDeEntrada) {
    const entrada = porEntrada.get(String(linha.entrada_id));
    if (!entrada) continue;
    const item = itens.get(String(linha.item_id));
    const nota = texto(entrada.numero_nota, 30);
    linhas.push({
      data: entrada.created_at,
      movimento: `E#${entrada.id}`,
      sentido: "ENTRADA",
      origem: rotular(entrada.tipo) || "Entrada",
      acao: "Registro",
      documento: [`Entrada #${entrada.id}`, nota ? `NF ${nota}` : ""].filter(Boolean).join(" · "),
      status: rotular(entrada.status) || "Confirmada",
      item: primeiro(linha.titulo, item?.titulo, `Item #${linha.item_id}`),
      quantidade: Number(linha.quantidade ?? 0),
      saldoAnterior: linha.saldo_anterior ?? null,
      saldoResultante: linha.saldo_resultante ?? null,
      custoUnitario: custoDoCadastro(item),
      parte: primeiro(fornecedores.get(String(entrada.fornecedor_id))?.nomerazaosocial),
      responsavel: primeiro(usuarios.get(String(entrada.created_by))?.nome),
    });
  }

  for (const linha of itensDeSaida) {
    const saida = porSaida.get(String(linha.saida_id));
    if (!saida) continue;
    const item = itens.get(String(linha.item_id));
    linhas.push({
      data: saida.created_at,
      movimento: `S#${saida.id}`,
      sentido: "SAIDA",
      origem: rotular(saida.motivo) || "Saída",
      acao: "Registro",
      documento: `Saída #${saida.id}`,
      status: rotular(saida.status) || "Confirmada",
      item: primeiro(item?.titulo, `Item #${linha.item_id}`),
      quantidade: Number(linha.quantidade ?? 0),
      saldoAnterior: linha.saldo_anterior ?? null,
      saldoResultante: linha.saldo_resultante ?? null,
      custoUnitario: custoDoCadastro(item),
      parte: primeiro(saida.funcionario, saida.setor, centros.get(String(saida.centro_custo_id))?.nome),
      responsavel: primeiro(usuarios.get(String(saida.created_by))?.nome),
    });
  }

  return linhas.sort((a, b) => a.data.localeCompare(b.data) || a.movimento.localeCompare(b.movimento));
}

/** Entradas e saidas somadas por origem, para fechar o relatorio. */
function resumoPorOrigem(linhas: Linha[]) {
  const acumulado = new Map<
    string,
    { movimentos: number; qtdEntrada: number; qtdSaida: number; vlrEntrada: number; vlrSaida: number }
  >();

  for (const linha of linhas) {
    const chave = linha.origem || "Sem origem";
    const atual =
      acumulado.get(chave) ?? { movimentos: 0, qtdEntrada: 0, qtdSaida: 0, vlrEntrada: 0, vlrSaida: 0 };
    const valor = linha.quantidade * linha.custoUnitario;
    atual.movimentos += 1;
    if (linha.sentido === "ENTRADA") {
      atual.qtdEntrada += linha.quantidade;
      atual.vlrEntrada += valor;
    } else {
      atual.qtdSaida += linha.quantidade;
      atual.vlrSaida += valor;
    }
    acumulado.set(chave, atual);
  }

  const linhasResumo = [...acumulado.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
    .map(([origem, total]) => [
      origem,
      total.movimentos,
      total.qtdEntrada,
      total.qtdSaida,
      total.qtdEntrada - total.qtdSaida,
      Number(total.vlrEntrada.toFixed(2)),
      Number(total.vlrSaida.toFixed(2)),
      Number((total.vlrEntrada - total.vlrSaida).toFixed(2)),
    ]);

  const geral = [...acumulado.values()].reduce(
    (total, atual) => ({
      movimentos: total.movimentos + atual.movimentos,
      qtdEntrada: total.qtdEntrada + atual.qtdEntrada,
      qtdSaida: total.qtdSaida + atual.qtdSaida,
      vlrEntrada: total.vlrEntrada + atual.vlrEntrada,
      vlrSaida: total.vlrSaida + atual.vlrSaida,
    }),
    { movimentos: 0, qtdEntrada: 0, qtdSaida: 0, vlrEntrada: 0, vlrSaida: 0 },
  );

  linhasResumo.push([
    "TOTAL",
    geral.movimentos,
    geral.qtdEntrada,
    geral.qtdSaida,
    geral.qtdEntrada - geral.qtdSaida,
    Number(geral.vlrEntrada.toFixed(2)),
    Number(geral.vlrSaida.toFixed(2)),
    Number((geral.vlrEntrada - geral.vlrSaida).toFixed(2)),
  ]);

  return linhasResumo;
}

type SheetSpec = { name: string; headers: string[]; rows: unknown[][]; widths: number[] };

function montarPlanilha(sheets: SheetSpec[]) {
  const workbook = XLSX.utils.book_new();
  sheets.forEach((spec) => {
    const sheet = XLSX.utils.aoa_to_sheet([spec.headers, ...spec.rows]);
    sheet["!cols"] = spec.widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, sheet, spec.name);
  });
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export async function GET(request: Request) {
  try {
    await requireRelatoriosAccess();
    const { searchParams } = new URL(request.url);
    const usoConsumo = searchParams.get("inventario") === "uso-consumo";

    const linhas = usoConsumo
      ? await linhasDeUsoConsumo(searchParams)
      : await linhasDeProdutos(searchParams);

    const rows = linhas.map((linha) => [
      formatarData(linha.data),
      linha.movimento,
      linha.sentido === "ENTRADA" ? "Entrada" : "Saída",
      linha.origem,
      linha.acao,
      linha.documento,
      linha.status,
      linha.item,
      linha.quantidade,
      linha.saldoAnterior ?? "",
      linha.saldoResultante ?? "",
      Number((linha.quantidade * linha.custoUnitario).toFixed(2)),
      linha.parte,
      linha.responsavel,
    ]);

    const buffer = montarPlanilha([
      {
        name: "Movimentos",
        headers: [
          "Data",
          "Movimento",
          "Tipo",
          "Origem",
          "Ação",
          "Documento",
          "Status",
          "Item",
          "Qtd.",
          "Saldo anterior",
          "Saldo resultante",
          "Valor do movimento (R$)",
          "Fornecedor / destino",
          "Responsável",
        ],
        rows,
        widths: [18, 12, 10, 20, 10, 32, 14, 38, 8, 14, 16, 22, 30, 24],
      },
      {
        name: "Resumo",
        headers: [
          "Origem",
          "Movimentos",
          "Qtd. entradas",
          "Qtd. saídas",
          "Qtd. líquida",
          "Valor entradas (R$)",
          "Valor saídas (R$)",
          "Valor líquido (R$)",
        ],
        rows: resumoPorOrigem(linhas),
        widths: [24, 14, 16, 14, 14, 20, 20, 20],
      },
    ]);

    const nome = usoConsumo ? "movimentacao_uso_consumo" : "movimentacao_estoque";
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nome}_${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao gerar relatório de movimentação de estoque." },
      { status: error?.statusCode || 500 },
    );
  }
}
