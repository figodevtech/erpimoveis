/** Cada banco atende um estabelecimento; a competência só escolhe sozinha quando não há dúvida. */
export function singleCompanyId(ids: readonly number[]): { id: number } | { error: "NENHUMA" | "VARIAS" } {
  const unique = Array.from(new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0)));
  if (unique.length === 1) return { id: unique[0] };
  return { error: unique.length === 0 ? "NENHUMA" : "VARIAS" };
}

/**
 * Meses (AAAA-MM) fechados que uma troca de data fiscal de entrada atingiria. A
 * data sai de uma competência e entra em outra: as duas precisam estar abertas.
 * Mudar dentro do mesmo mês fechado também altera o snapshot, então bloqueia.
 */
export function closedMonthsAffectedByDateChange(
  currentDate: string | null | undefined,
  nextDate: string,
  closedMonths: ReadonlySet<string>,
): string[] {
  const current = String(currentDate ?? "").slice(0, 10);
  if (current === nextDate) return [];
  const months = new Set([current.slice(0, 7), nextDate.slice(0, 7)].filter(Boolean));
  return Array.from(months).filter((month) => closedMonths.has(month)).sort();
}
