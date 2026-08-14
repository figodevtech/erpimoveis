import { formatPaymentMethodLabel, type PlannedPayment } from "@/lib/payment-methods";

export type PrintDocumentType = "OS" | "VENDA";

export type RecordedPayment = {
  metodo: string | null;
  valor: number;
};

export type PrintPaymentEntry = {
  metodo: string;
  label: string;
  valor: number | null;
  parcelas: number | null;
};

export type PrintPaymentSummary = {
  kind: "PREVISTO" | "REALIZADO";
  title: string;
  entries: PrintPaymentEntry[];
};

const PAID_STATUSES: Record<PrintDocumentType, Set<string>> = {
  OS: new Set(["CONCLUIDO"]),
  VENDA: new Set(["FINALIZADA", "PAGO"]),
};

const WITHOUT_PAYMENT_STATUSES = new Set([
  "CANCELADO",
  "CANCELADA",
  "SEM_COBRANCA",
]);

const money = (value: unknown) => {
  const number = Number(value);
  return Math.round((Number.isFinite(number) ? number : 0) * 100) / 100;
};

const normalizeMethod = (value: unknown) =>
  String(value ?? "").trim().toUpperCase();

export function isPaidPrintStatus(type: PrintDocumentType, status: unknown) {
  return PAID_STATUSES[type].has(normalizeMethod(status));
}

function aggregateRecordedPayments(payments: RecordedPayment[]): PrintPaymentEntry[] {
  const byMethod = new Map<string, number>();

  for (const payment of payments) {
    const method = normalizeMethod(payment.metodo);
    const value = money(payment.valor);
    if (!method || value <= 0) continue;
    byMethod.set(method, money((byMethod.get(method) ?? 0) + value));
  }

  return Array.from(byMethod, ([metodo, valor]) => ({
    metodo,
    label: formatPaymentMethodLabel(metodo),
    valor,
    parcelas: null,
  }));
}

function normalizePlannedPayments({
  pagamentosPrevistos,
  formaPagamento,
  parcelasPagamento,
}: {
  pagamentosPrevistos?: PlannedPayment[] | null;
  formaPagamento?: string | null;
  parcelasPagamento?: number | null;
}): PrintPaymentEntry[] {
  if (Array.isArray(pagamentosPrevistos) && pagamentosPrevistos.length > 0) {
    return pagamentosPrevistos.flatMap((payment) => {
      const metodo = normalizeMethod(payment?.metodo);
      const valor = money(payment?.valor);
      if (!metodo || valor <= 0) return [];

      const installments = Number(payment?.parcelas ?? 0);
      return [{
        metodo,
        label: formatPaymentMethodLabel(metodo),
        valor,
        parcelas: Number.isInteger(installments) && installments > 1
          ? installments
          : null,
      }];
    });
  }

  const metodo = normalizeMethod(formaPagamento);
  if (!metodo) return [];

  const installments = Number(parcelasPagamento ?? 0);
  return [{
    metodo,
    label: formatPaymentMethodLabel(metodo),
    valor: null,
    parcelas: Number.isInteger(installments) && installments > 1
      ? installments
      : null,
  }];
}

export function buildPrintPaymentSummary({
  type,
  status,
  pagamentosPrevistos,
  formaPagamento,
  parcelasPagamento,
  recordedPayments = [],
}: {
  type: PrintDocumentType;
  status: unknown;
  pagamentosPrevistos?: PlannedPayment[] | null;
  formaPagamento?: string | null;
  parcelasPagamento?: number | null;
  recordedPayments?: RecordedPayment[];
}): PrintPaymentSummary | null {
  const normalizedStatus = normalizeMethod(status);

  if (isPaidPrintStatus(type, normalizedStatus)) {
    const entries = aggregateRecordedPayments(recordedPayments);
    return entries.length > 0
      ? { kind: "REALIZADO", title: "Pagamentos registrados", entries }
      : null;
  }

  if (WITHOUT_PAYMENT_STATUSES.has(normalizedStatus)) return null;

  const entries = normalizePlannedPayments({
    pagamentosPrevistos,
    formaPagamento,
    parcelasPagamento,
  });
  return entries.length > 0
    ? { kind: "PREVISTO", title: "Pagamento previsto", entries }
    : null;
}
