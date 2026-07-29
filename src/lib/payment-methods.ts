export const PAYMENT_METHOD_OPTIONS = [
  { value: "CREDITO", label: "Crédito" },
  { value: "DEBITO", label: "Débito" },
  { value: "DINHEIRO", label: "Dinheiro" },
  { value: "PIX", label: "Pix" },
  { value: "BOLETO", label: "Boleto" },
] as const;

export type PaymentMethodOption = (typeof PAYMENT_METHOD_OPTIONS)[number]["value"];

export type PlannedPayment = {
  metodo: PaymentMethodOption;
  valor: number;
  parcelas?: number | null;
};
