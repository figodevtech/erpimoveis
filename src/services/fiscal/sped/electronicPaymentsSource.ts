import "server-only";

import type { SpedDiagnostic } from "@/lib/sped/efd-icms-ipi";
import { INSTITUICOES_FINANCEIRAS } from "@/lib/financeiro/instituicoes-financeiras";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  build1601FromReceipts,
  splitForClassification,
  type Sped1601Account,
  type Sped1601Receipt,
  type Sped1601Row,
  type Sped1601Split,
} from "./electronicPayments";
import { civilDateInTimezone } from "./guards";
import { fetchAllByIds, fetchAllPages, type SpedCollectionReport } from "./sourcePagination";

type Row = Record<string, any>;
type Track = <T>(result: { rows: T[]; report: SpedCollectionReport }) => T[];

const TITLE_COLUMNS = "id, valor, valor_acrescimos, metodopagamento, banco_id, adiantamento_id, ordemservicoid, vendaid, competencia_em, data, plano_de_conta_id";

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shift(civilDate: string, days: number): string {
  const [year, month, day] = civilDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Receita que é título de cliente: sem estorno, transferência, adiantamento nem abono. */
function receivableTitles(builder: any) {
  return builder
    .eq("tipo", "RECEITA")
    .not("is_deleted", "is", true)
    .is("estorno_transacao_id", null)
    .is("transferencia_id", null)
    .not("eh_adiantamento", "is", true)
    .not("abonado", "is", true);
}

/**
 * Recebimentos das vendas pagas no mês, com o que já foi pago e o que está a
 * receber, mais as receitas avulsas cuja competência cai no mês.
 */
export async function collect1601FromFinance(input: {
  start: string;
  end: string;
  timezone: string | null;
  track: Track;
}): Promise<{ rows: Sped1601Row[]; diagnostics: SpedDiagnostic[] }> {
  const { start, end, track } = input;
  const from = `${shift(start, -1)}T00:00:00`;
  const to = `${shift(end, 1)}T23:59:59.999`;
  const inMonth = (instant: unknown) => {
    const text = String(instant ?? "");
    if (!text) return false;
    const civil = civilDateInTimezone(text, input.timezone) ?? text.slice(0, 10);
    return civil >= start && civil <= end;
  };

  const [sales, looseTitles, accountRows] = await Promise.all([

    fetchAllPages<Row>("vendas pagas no mês (1601)", ({ from: first, to: last }) => supabaseAdmin
      .from("venda").select("id, pagamento_em, status", { count: "exact" })
      .neq("status", "CANCELADA").gte("pagamento_em", from).lte("pagamento_em", to)
      .order("id").range(first, last)).then(track),
    fetchAllPages<Row>("receitas avulsas com competência no mês (1601)", ({ from: first, to: last }) => receivableTitles(supabaseAdmin
      .from("transacao").select(TITLE_COLUMNS, { count: "exact" }))
      .is("ordemservicoid", null).is("vendaid", null).is("baixa_de_transacao_id", null)
      .or(`and(competencia_em.gte.${from},competencia_em.lte.${to}),and(competencia_em.is.null,data.gte.${from},data.lte.${to})`)
      .order("id").range(first, last)).then(track),
    fetchAllPages<Row>("contas bancárias (1601)", ({ from: first, to: last }) => supabaseAdmin
      .from("bancoconta").select("id, titulo, cnpj_instituicao", { count: "exact" })
      .order("id").range(first, last)).then(track),
  ]);

  const saleIds = sales.filter((row) => inMonth(row.pagamento_em)).map((row) => number(row.id));
  const [saleTitles] = await Promise.all([
    fetchAllByIds<Row, number>("recebimentos das vendas (1601)", saleIds, (ids, range) => receivableTitles(supabaseAdmin
      .from("transacao").select(TITLE_COLUMNS, { count: "exact" }))
      .in("vendaid", ids).is("baixa_de_transacao_id", null).order("id").range(range.from, range.to)).then(track),
  ]);

  // Receita avulsa: o plano de contas diz se é venda, serviço, outra receita ou nada.
  const looseInMonth = looseTitles.filter((row) => inMonth(row.competencia_em ?? row.data));
  const planIds = Array.from(new Set(looseInMonth.map((row) => number(row.plano_de_conta_id)).filter(Boolean)));
  const plans = await fetchAllByIds<Row, number>("planos de conta das receitas (1601)", planIds, (ids, range) => supabaseAdmin
    .from("planosdeconta").select("id, classificacao_especifica_id, grupo:grupo_id(classificacao_padrao_id)", { count: "exact" })
    .in("id", ids).order("id").range(range.from, range.to)).then(track);
  const classificationIds = Array.from(new Set(plans.flatMap((row) => {
    const group = Array.isArray(row.grupo) ? row.grupo[0] : row.grupo;
    return [number(row.classificacao_especifica_id), number(group?.classificacao_padrao_id)];
  }).filter(Boolean)));
  const classifications = await fetchAllByIds<Row, number>("classificações de resultado (1601)", classificationIds, (ids, range) => supabaseAdmin
    .from("classificacoes_resultado").select("id, codigo", { count: "exact" }).in("id", ids).order("id").range(range.from, range.to)).then(track);
  const codeById = new Map(classifications.map((row) => [number(row.id), String(row.codigo)]));
  const codeByPlan = new Map(plans.map((row) => {
    const group = Array.isArray(row.grupo) ? row.grupo[0] : row.grupo;
    return [number(row.id), codeById.get(number(row.classificacao_especifica_id)) ?? codeById.get(number(group?.classificacao_padrao_id)) ?? null];
  }));

  const titles: Array<{ row: Row; split: Sped1601Split }> = [
    ...saleTitles.map((row) => ({ row, split: { vs: 1, iss: 0, outros: 0 } })),
    ...looseInMonth.map((row) => ({ row, split: splitForClassification(codeByPlan.get(number(row.plano_de_conta_id))) })),
  ].filter(({ split }) => split.vs + split.iss + split.outros > 0);

  // Baixa parcial: o título guarda o valor cheio e cada pagamento vira uma
  // transação filha, com o meio e a conta de quem pagou. A parte paga segue a
  // filha; o saldo em aberto segue o título.
  const titleIds = titles.map(({ row }) => number(row.id));
  const children = await fetchAllByIds<Row, number>("baixas parciais dos títulos (1601)", titleIds, (ids, range) => receivableTitles(supabaseAdmin
    .from("transacao").select(`${TITLE_COLUMNS}, baixa_de_transacao_id`, { count: "exact" }))
    .in("baixa_de_transacao_id", ids).order("id").range(range.from, range.to)).then(track);
  const childrenByTitle = new Map<number, Row[]>();
  for (const child of children) {
    const titleId = number(child.baixa_de_transacao_id);
    childrenByTitle.set(titleId, [...(childrenByTitle.get(titleId) ?? []), child]);
  }
  // Recebimento estornado não é recebimento.
  const reversed = new Set((await fetchAllByIds<Row, number>("estornos dos recebimentos (1601)", [...titleIds, ...children.map((row) => number(row.id))], (ids, range) => supabaseAdmin
    .from("transacao").select("id, estorno_transacao_id", { count: "exact" }).in("estorno_transacao_id", ids).not("is_deleted", "is", true)
    .order("id").range(range.from, range.to)).then(track)).map((row) => number(row.estorno_transacao_id)));

  // Parcela quitada por antecipação de recebíveis fica sem conta, para o
  // dinheiro não entrar duas vezes no caixa: a conta é a da antecipação, que é
  // o banco da maquininha (ou do boleto) que pagou.
  const advanceIds = Array.from(new Set([...titles.map(({ row }) => row), ...children]
    .filter((row) => !number(row.banco_id) && number(row.adiantamento_id))
    .map((row) => number(row.adiantamento_id))));
  const advanceAccount = new Map((await fetchAllByIds<Row, number>("antecipações dos recebimentos (1601)", advanceIds, (ids, range) => supabaseAdmin
    .from("transacao").select("id, banco_id", { count: "exact" }).in("id", ids).order("id").range(range.from, range.to)).then(track))
    .map((row) => [number(row.id), number(row.banco_id) || null]));
  const accountOf = (row: Row) => number(row.banco_id) || advanceAccount.get(number(row.adiantamento_id)) || null;

  const net = (row: Row) => number(row.valor) - number(row.valor_acrescimos);
  const receipts: Sped1601Receipt[] = [];
  for (const { row, split } of titles) {
    if (reversed.has(number(row.id))) continue;
    const paid = (childrenByTitle.get(number(row.id)) ?? []).filter((child) => !reversed.has(number(child.id)));
    for (const child of paid) {
      receipts.push({ transactionId: number(child.id), method: String(child.metodopagamento ?? ""), accountId: accountOf(child), amount: net(child), split });
    }
    const open = net(row) - paid.reduce((sum, child) => sum + net(child), 0);
    if (open > 0.004) {
      receipts.push({ transactionId: number(row.id), method: String(row.metodopagamento ?? ""), accountId: accountOf(row), amount: open, split });
    }
  }

  const accounts = new Map<number, Sped1601Account>(accountRows.map((row) => [number(row.id), {
    id: number(row.id),
    title: String(row.titulo ?? ""),
    cnpj: String(row.cnpj_instituicao ?? "").trim() || null,
  }]));
  const knownNames = new Map(INSTITUICOES_FINANCEIRAS.map((item) => [item.cnpj, item.nome]));
  return build1601FromReceipts({ receipts, accounts, institutionName: (cnpj) => knownNames.get(cnpj) ?? null });
}
