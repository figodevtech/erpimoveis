export const SERVICE_ORDER_COMPLETION_COLUMN = "execucao_fim_em" as const;

export type ServiceOrderCompletionRow = {
  status?: string | null;
  dataentrada?: string | null;
  execucao_fim_em?: string | null;
};

const NON_OPEN_STATUSES = new Set([
  "PAGAMENTO",
  "FATURAMENTO",
  "CONCLUIDO",
  "SEM_COBRANCA",
  "CANCELADO",
  "ORCAMENTO_RECUSADO",
]);

/**
 * A conclusão da OS é o fim da execução técnica. Pagamento e retirada física
 * são eventos posteriores e independentes.
 *
 * Não há filtro de status aqui de propósito: o carimbo é a definição. Quem muda
 * status responde por ele — `fn_os_execucao_set_times` apaga o carimbo quando a
 * OS volta para EM_ANDAMENTO, é cancelada (20260902100000) ou volta para
 * qualquer status anterior à execução (20260916180000). Por isso OS cancelada
 * ou reiniciada não chega a passar por esta função como concluída.
 */
export function serviceOrderCompletionDate(row: ServiceOrderCompletionRow) {
  return row.execucao_fim_em ?? null;
}

export function isServiceOrderCompleted(row: ServiceOrderCompletionRow) {
  return Boolean(serviceOrderCompletionDate(row));
}

export function serviceOrderCompletionDurationHours(
  row: ServiceOrderCompletionRow,
) {
  const completedAt = serviceOrderCompletionDate(row);
  if (!row.dataentrada || !completedAt) return null;

  const duration =
    (new Date(completedAt).getTime() - new Date(row.dataentrada).getTime()) /
    (1000 * 60 * 60);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

export function isServiceOrderOpen(status: unknown) {
  return !NON_OPEN_STATUSES.has(String(status ?? "").toUpperCase());
}
