export const ASAAS_BILLING_TYPES = ["PIX", "CREDIT_CARD", "BOLETO"] as const;

export type AsaasBillingType = (typeof ASAAS_BILLING_TYPES)[number];

export const PAYMENT_METHOD_LABELS: Record<AsaasBillingType | "DEBIT_CARD", string> = {
  PIX: "Pix",
  DEBIT_CARD: "Cartão de débito",
  CREDIT_CARD: "Cart\u00e3o de cr\u00e9dito",
  BOLETO: "Boleto banc\u00e1rio",
};

export function isAsaasBillingType(value: unknown): value is AsaasBillingType {
  return ASAAS_BILLING_TYPES.includes(value as AsaasBillingType);
}
