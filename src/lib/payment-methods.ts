export type PaymentMethodOption = string;

/**
 * Lista de emergência, usada só enquanto a do banco não chega ou se ela falhar.
 *
 * A lista de verdade é o enum `metodo_pagamento` do banco, lido por
 * `listar_metodos_pagamento()`. Cada empresa pode ter os seus, e o Demir já usa
 * três que não estão aqui — DEBITO AUTOMATICO, CHEQUE e CREDITO EM CONTA.
 *
 * Por isso esta lista não deve ser usada para montar seletor nenhum: quem
 * precisa escolher uma forma de pagamento usa `usePaymentMethodOptions`, que
 * busca no banco e cai aqui apenas para não deixar o campo vazio.
 */
export const METODOS_PAGAMENTO_PADRAO: PaymentMethodOption[] = [
  "PIX",
  "CREDITO",
  "DEBITO",
  "BOLETO",
  "TRANSFERENCIA",
  "TED",
  "DOC",
  "DINHEIRO",
  "PERMUTA",
];

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
