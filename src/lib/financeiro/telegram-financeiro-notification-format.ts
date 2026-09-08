import { escapeTelegramHtml } from "@/lib/integrations/telegram";
import { transactionCounterparty } from "@/lib/financeiro/telegram-daily-summary-format";
import type { FinanceiroNotificationEvent } from "@/lib/financeiro/telegram-financeiro-events";

export type TelegramFinanceiroTransaction = {
  id: number;
  descricao: string | null;
  tipo: string;
  valor: number | string | null;
  data: string | null;
  vencimento_em: string | null;
  pago_em: string | null;
  categoria: string | null;
  metodopagamento: string | null;
  pendente: boolean | null;
  updated_at: string | null;
  ordemservicoid: number | null;
  vendaid: number | null;
  entrada_id: number | null;
  usoconsumo_entrada_id: number | null;
  transferencia_id: number | null;
  nomepagador: string | null;
  cpfcnpjpagador: string | null;
  fornecedor: { nomerazaosocial?: string | null; nomefantasia?: string | null } | Array<{ nomerazaosocial?: string | null; nomefantasia?: string | null }> | null;
  banco: { titulo?: string | null } | Array<{ titulo?: string | null }> | null;
  transferencia: {
    valor?: number | string | null;
    data?: string | null;
    origem?: { titulo?: string | null } | Array<{ titulo?: string | null }> | null;
    destino?: { titulo?: string | null } | Array<{ titulo?: string | null }> | null;
  } | null;
};

const EVENT_HEADINGS: Record<FinanceiroNotificationEvent, string> = {
  CONTA_PAGAR_CRIADA: "🧾 <b>Conta a pagar registrada</b>",
  CONTA_RECEBER_CRIADA: "🧾 <b>Conta a receber registrada</b>",
  MOVIMENTO_CAIXA_CRIADO: "💸 <b>Movimento no caixa</b>",
  CONTA_PAGAR_LIQUIDADA: "📤 <b>Conta a pagar baixada</b>",
  CONTA_RECEBER_LIQUIDADA: "📥 <b>Conta a receber baixada</b>",
  BAIXA_ESTORNADA: "↩️ <b>Baixa estornada</b>",
  LANCAMENTO_EXCLUIDO: "🗑️ <b>Lançamento excluído</b>",
  TRANSFERENCIA_ENTRE_CONTAS: "🔁 <b>Transferência entre contas</b>",
};

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatMoney(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return null;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
}

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "America/Fortaleza",
  }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Fortaleza",
  }).format(date);
}

function humanize(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replaceAll("_", " ")
    .toLocaleLowerCase("pt-BR")
    .replace(/^./, (letter) => letter.toLocaleUpperCase("pt-BR"));
}

function origin(transaction: TelegramFinanceiroTransaction) {
  if (transaction.ordemservicoid) return `OS #${transaction.ordemservicoid}`;
  if (transaction.vendaid) return `Venda #${transaction.vendaid}`;
  if (transaction.entrada_id) return `Entrada #${transaction.entrada_id}`;
  if (transaction.usoconsumo_entrada_id) return `Uso e consumo #${transaction.usoconsumo_entrada_id}`;
  return `Lançamento #${transaction.id}`;
}

function pushLine(lines: string[], label: string, value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return;
  lines.push(`<b>${label}:</b> ${escapeTelegramHtml(value)}`);
}

function buildTransferLines(transaction: TelegramFinanceiroTransaction) {
  const transfer = transaction.transferencia;
  const from = relationOne(transfer?.origem)?.titulo ?? "Conta de origem";
  const to = relationOne(transfer?.destino)?.titulo ?? "Conta de destino";
  const lines: string[] = [];
  pushLine(lines, "De", from);
  pushLine(lines, "Para", to);
  pushLine(lines, "Valor", formatMoney(transfer?.valor ?? transaction.valor));
  pushLine(lines, "Data", formatDate(transfer?.data ?? transaction.data));
  pushLine(lines, "Descrição", transaction.descricao);
  return lines;
}

export function buildFinanceiroNotificationMessage(
  event: FinanceiroNotificationEvent,
  transaction: TelegramFinanceiroTransaction,
  actorName: string | null = null,
) {
  if (event === "TRANSFERENCIA_ENTRE_CONTAS") {
    const lines = buildTransferLines(transaction);
    pushLine(lines, "Registrada por", actorName);
    return [EVENT_HEADINGS[event], "", ...lines].join("\n").slice(0, 4000);
  }

  const { label: counterpartyLabel, value: counterpartyName } = transactionCounterparty(transaction);
  const settled = event === "CONTA_PAGAR_LIQUIDADA" || event === "CONTA_RECEBER_LIQUIDADA";
  const lines: string[] = [];

  pushLine(lines, "Lançamento", transaction.descricao || `Conta #${transaction.id}`);
  pushLine(lines, counterpartyLabel, counterpartyName);
  pushLine(lines, "Valor", formatMoney(transaction.valor));
  pushLine(lines, "Categoria", transaction.categoria || "Não informada");

  if (settled || event === "MOVIMENTO_CAIXA_CRIADO") {
    pushLine(lines, "Pago em", formatDate(transaction.pago_em ?? transaction.data));
    pushLine(lines, "Conta", relationOne(transaction.banco)?.titulo);
    pushLine(lines, "Método", humanize(transaction.metodopagamento));
  } else {
    pushLine(lines, "Vencimento", formatDate(transaction.vencimento_em ?? transaction.data));
  }

  if (event === "BAIXA_ESTORNADA") {
    pushLine(lines, "Vencimento", formatDate(transaction.vencimento_em ?? transaction.data));
    lines.push("", "<i>O título voltou para em aberto e o dinheiro saiu do fluxo de caixa.</i>");
  }

  pushLine(lines, "Origem", origin(transaction));
  pushLine(lines, event === "LANCAMENTO_EXCLUIDO" ? "Excluído por" : settled ? "Baixado por" : "Registrado por", actorName);

  if (event === "LANCAMENTO_EXCLUIDO") {
    pushLine(lines, "Em", formatDateTime(transaction.updated_at));
  }

  return [EVENT_HEADINGS[event], "", ...lines].join("\n").slice(0, 4000);
}
