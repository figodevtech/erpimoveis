export const NFE_PAYMENT_OPTIONS = [
  { value: "01", label: "Dinheiro" },
  { value: "02", label: "Cheque" },
  { value: "03", label: "Cartão de crédito" },
  { value: "04", label: "Cartão de débito" },
  { value: "15", label: "Boleto bancário" },
  { value: "16", label: "Depósito bancário" },
  { value: "17", label: "PIX" },
  { value: "18", label: "Transferência bancária" },
  { value: "90", label: "Sem pagamento" },
  { value: "99", label: "Outros" },
] as const;

export const NFE_PRESENCE_OPTIONS = [
  { value: "0", label: "Não se aplica" },
  { value: "1", label: "Operação presencial" },
  { value: "2", label: "Internet" },
  { value: "3", label: "Teleatendimento" },
  { value: "5", label: "Operação presencial fora do estabelecimento" },
  { value: "9", label: "Outros" },
] as const;

export const NFE_FREIGHT_OPTIONS = [
  { value: "0", label: "Contratação por conta do remetente (CIF)" },
  { value: "1", label: "Contratação por conta do destinatário (FOB)" },
  { value: "2", label: "Contratação por conta de terceiros" },
  { value: "3", label: "Transporte próprio por conta do remetente" },
  { value: "4", label: "Transporte próprio por conta do destinatário" },
  { value: "9", label: "Sem ocorrência de transporte" },
] as const;

function normalizeLabel(value: unknown) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

export function mapSalesChannelToPresence(value: unknown) {
  const channel = normalizeLabel(value);
  if (!channel) return "9";
  if (channel === "PDV" || channel.includes("PRESENCIAL") || channel.includes("LOJA")) return "1";
  if (
    channel.includes("ONLINE") ||
    channel.includes("INTERNET") ||
    channel.includes("ECOMMERCE") ||
    channel.includes("MARKETPLACE") ||
    channel.includes("MERCADO_LIVRE")
  ) return "2";
  if (channel.includes("TELEFONE") || channel.includes("TELEATENDIMENTO")) return "3";
  return "9";
}

/** Converte as formas internas do ERP para os codigos tPag da NF-e 4.00. */
export function mapPaymentMethodToNFe(value: unknown) {
  const method = normalizeLabel(value);
  if (!method) return "99";
  if (method.includes("DINHEIRO") || method === "CASH") return "01";
  if (method.includes("CHEQUE")) return "02";
  if (method.includes("CREDITO")) return "03";
  if (method.includes("DEBITO")) return "04";
  if (method.includes("BOLETO")) return "15";
  if (method.includes("DEPOSITO")) return "16";
  if (method.includes("PIX")) return "17";
  if (method.includes("TRANSFER") || method === "TED" || method === "DOC") return "18";
  return "99";
}
