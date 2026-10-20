/** Cada banco atende um estabelecimento; a competência só escolhe sozinha quando não há dúvida. */
export function singleCompanyId(ids: readonly number[]): { id: number } | { error: "NENHUMA" | "VARIAS" } {
  const unique = Array.from(new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0)));
  if (unique.length === 1) return { id: unique[0] };
  return { error: unique.length === 0 ? "NENHUMA" : "VARIAS" };
}

/** cStat do protocolo que indica NF-e cancelada (101, 135, 151, 155) ou denegada (110, 301, 302, 303). */
const DFE_CANCELLED_OR_DENIED_CSTAT = new Set(["101", "135", "151", "155", "110", "301", "302", "303"]);

/**
 * DF-e recebido cancelado ou denegado pelo emitente. O status gravado é código
 * da SEFAZ: no resumo (resNFe) é o cSitNFe (1 autorizada, 2 denegada, 3
 * cancelada); na nota completa (procNFe) é o cStat do protocolo.
 */
export function isDfeCancelledOrDenied(row: { schema?: unknown; status?: unknown } | null | undefined): boolean {
  const status = String(row?.status ?? "").trim();
  if (/CANCEL|DENEG/i.test(status)) return true;
  if (/^resNFe/i.test(String(row?.schema ?? ""))) return status === "2" || status === "3";
  return DFE_CANCELLED_OR_DENIED_CSTAT.has(status);
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

/** Data civil (AAAA-MM-DD) de um instante no fuso do estabelecimento; null se algum dos dois for inválido. */
export function civilDateInTimezone(instant: string | null | undefined, timeZone: string | null | undefined): string | null {
  if (!instant || !timeZone) return null;
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const part = (type: string) => parts.find((item) => item.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return null;
  }
}
