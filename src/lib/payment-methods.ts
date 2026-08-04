export type PaymentMethodOption = string;

export type PaymentMethodItem = {
  value: PaymentMethodOption;
  label: string;
};

export type PlannedPayment = {
  metodo: PaymentMethodOption;
  valor: number;
  parcelas?: number | null;
};

export function formatPaymentMethodLabel(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return value;
  if (normalized === "CREDITO") return "Crédito";
  if (normalized === "DEBITO") return "Débito";
  if (normalized === "PIX") return "Pix";
  if (/^[A-Z]{2,4}$/.test(normalized)) return normalized;

  return normalized
    .toLocaleLowerCase("pt-BR")
    .replace(/_/g, " ")
    .replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase("pt-BR"));
}
