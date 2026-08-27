import type { OperationalEvent } from "./contracts";

const GLOBAL_ATTENTION_IGNORED_TYPES = new Set<OperationalEvent["tipo"]>([
  "ESTOQUE_BAIXO",
  "NFE_REJEITADA",
  "NFSE_REJEITADA",
]);

export function isOperationalEventEligibleForGlobalAttention(
  event: Pick<OperationalEvent, "tipo" | "prioridade">,
) {
  return event.prioridade === "CRITICO" && !GLOBAL_ATTENTION_IGNORED_TYPES.has(event.tipo);
}

export function overdueAccountAttentionCopy(input: {
  id: number;
  tipo: string;
  descricao: string | null;
  clienteNome: string | null;
  vencimentoEm: string;
}) {
  const natureza = input.tipo.toUpperCase() === "RECEITA" ? "receber" : "pagar";
  const descricao = input.descricao?.trim() || null;
  const clienteNome = input.clienteNome?.trim() || null;
  const vencimento = new Date(input.vencimentoEm).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  return {
    titulo: `Conta a ${natureza} #${input.id} vencida`,
    detalhe: [
      descricao,
      clienteNome ? `Cliente: ${clienteNome}` : null,
      `Venceu em ${vencimento}`,
    ].filter((part): part is string => Boolean(part)).join(" · "),
  };
}
