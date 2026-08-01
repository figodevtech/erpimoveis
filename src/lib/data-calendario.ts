/**
 * Datas escolhidas em calendario chegam do front como "YYYY-MM-DD", sem hora.
 *
 * A sessao do Postgres roda em UTC, entao o cast direto (`'2026-08-26'::timestamptz`)
 * vira meia-noite UTC. Lido de volta no fuso do Brasil (UTC-3), isso aparece como
 * 25/08 21:00 — um dia antes do que o usuario escolheu.
 *
 * Ancorar ao meio-dia mantem o dia correto em qualquer fuso entre UTC-12 e UTC+11.
 */
export function dataDoCalendario(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? `${normalized}T12:00:00` : normalized;
}
