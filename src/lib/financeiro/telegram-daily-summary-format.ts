import { saldoEmAberto } from "@/lib/financeiro/transacao";
import { escapeTelegramHtml } from "@/lib/integrations/telegram";

const TIME_ZONE = "America/Fortaleza";
const MAX_MESSAGE_LENGTH = 3800;

export type FinancialTransaction = {
  id: number;
  descricao: string | null;
  valor: number | string | null;
  valorLiquido: number | string | null;
  valor_descontos: number | string | null;
  /** Baixas parciais já cobertas. Zero, ou ausente, no título comum. */
  valor_baixado?: number | string | null;
  pendente?: boolean | null;
  tipo: string;
  data: string;
  categoria: string | null;
  ordemservicoid: number | null;
  vendaid: number | null;
  fornecedor: { nomerazaosocial?: string | null; nomefantasia?: string | null } | Array<{ nomerazaosocial?: string | null; nomefantasia?: string | null }> | null;
};

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function zonedParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}:${get("second")}`,
  };
}

export function fortalezaDateTime(date = new Date()) {
  return zonedParts(date);
}

export function financialTransactionDateKey(value: string) {
  return zonedParts(new Date(value)).date;
}

function formatDateKey(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

/**
 * Quanto esta conta ainda custa.
 *
 * O resumo lista contas a pagar em aberto, e o que importa ali é o que falta
 * desembolsar. Uma conta de R$ 1.000 já paga pela metade cobra R$ 500 hoje —
 * anunciar R$ 1.000 mandaria separar dinheiro que não vai sair.
 *
 * `saldoEmAberto` devolve o líquido inteiro quando não houve baixa parcial, que
 * é o caso de quase tudo e o comportamento de sempre.
 */
export function financialTransactionValue(transaction: FinancialTransaction) {
  return saldoEmAberto(transaction);
}

function transactionBlock(transaction: FinancialTransaction) {
  const supplier = relationOne(transaction.fornecedor);
  const supplierName = supplier?.nomefantasia || supplier?.nomerazaosocial || "Não informado";
  const reference = transaction.ordemservicoid
    ? `OS #${transaction.ordemservicoid}`
    : transaction.vendaid
      ? `Venda #${transaction.vendaid}`
      : `Lançamento #${transaction.id}`;
  return [
    `• <b>${escapeTelegramHtml(transaction.descricao || `Conta #${transaction.id}`)}</b>`,
    `  Fornecedor: ${escapeTelegramHtml(supplierName)}`,
    `  Categoria: ${escapeTelegramHtml(transaction.categoria || "Não informada")}`,
    `  Vencimento: ${formatDateKey(financialTransactionDateKey(transaction.data))}`,
    `  Valor: <b>${formatMoney(financialTransactionValue(transaction))}</b>`,
    `  Referência: ${escapeTelegramHtml(reference)}`,
  ].join("\n").slice(0, 1800);
}

function summaryHeader(referenceDate: string, overdue: FinancialTransaction[], today: FinancialTransaction[]) {
  const overdueTotal = overdue.reduce((total, item) => total + financialTransactionValue(item), 0);
  const todayTotal = today.reduce((total, item) => total + financialTransactionValue(item), 0);
  return [
    `💰 <b>Contas a pagar — ${formatDateKey(referenceDate)}</b>`,
    "",
    `🔴 Atrasadas: <b>${overdue.length}</b> · ${formatMoney(overdueTotal)}`,
    `🟡 Vencem hoje: <b>${today.length}</b> · ${formatMoney(todayTotal)}`,
    `Total geral: <b>${formatMoney(overdueTotal + todayTotal)}</b>`,
  ].join("\n");
}

export function buildFinancialSummaryMessages(referenceDate: string, transactions: FinancialTransaction[]) {
  const overdue = transactions.filter((item) => financialTransactionDateKey(item.data) < referenceDate);
  const today = transactions.filter((item) => financialTransactionDateKey(item.data) === referenceDate);
  const sections: Array<{ title: string; items: FinancialTransaction[] }> = [
    { title: "🔴 <b>ATRASADAS</b>", items: overdue },
    { title: "🟡 <b>VENCEM HOJE</b>", items: today },
  ].filter((section) => section.items.length > 0);
  const header = summaryHeader(referenceDate, overdue, today);
  if (sections.length === 0) return [`${header}\n\n✅ Não há contas pendentes vencidas ou com vencimento hoje.`];

  const chunks: string[] = [];
  let current = header;
  for (const section of sections) {
    const title = `\n\n${section.title}`;
    if (current.length + title.length > MAX_MESSAGE_LENGTH) {
      chunks.push(current);
      current = `${header}${title}`;
    } else current += title;

    for (const item of section.items) {
      const block = `\n\n${transactionBlock(item)}`;
      if (current.length + block.length > MAX_MESSAGE_LENGTH) {
        chunks.push(current);
        current = `${header}\n\n${section.title}${block}`;
      } else current += block;
    }
  }
  chunks.push(current);
  return chunks.map((chunk, index) => chunks.length > 1 ? `${chunk}\n\n<i>Parte ${index + 1} de ${chunks.length}</i>` : chunk);
}
