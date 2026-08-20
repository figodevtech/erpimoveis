export const PALETTE = [
  "#8b5cf6",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#f43f5e",
  "#3b82f6",
];

const CORES_SEMANTICAS: Record<string, string> = {
  CONCLUIDO: "#10b981",
  EM_ANDAMENTO: "#3b82f6",
  PAGAMENTO: "#8b5cf6",
  ORCAMENTO: "#06b6d4",
  ORCAMENTO_APROVADO: "#14b8a6",
  APROVACAO_ORCAMENTO: "#6366f1",
  AGUARDANDO_CHECKLIST: "#f59e0b",
  ORCAMENTO_RECUSADO: "#f97316",
  CANCELADO: "#ef4444",
  SEM_COBRANCA: "#64748b",
  URGENTE: "#e11d48",
  ALTA: "#f97316",
  MEDIA: "#f59e0b",
  NORMAL: "#3b82f6",
  BAIXA: "#06b6d4",
};

export function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

export function pickColorForKey(key: string) {
  const normalizada = String(key ?? "").trim().toUpperCase();
  if (CORES_SEMANTICAS[normalizada]) return CORES_SEMANTICAS[normalizada];
  const i = Math.abs(hashCode(normalizada)) % PALETTE.length;
  return PALETTE[i];
}
