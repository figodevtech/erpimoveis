import type { OperationalPeriod } from "./contracts";

const OFFICE_OFFSET = "-03:00";
const OFFICE_TIME_ZONE = "America/Sao_Paulo";

export const OPERATIONAL_PERIOD_LABELS: Record<OperationalPeriod, {
  button: string;
  counter: string;
  detail: string;
  metric: string;
}> = {
  DIARIO: { button: "DIÁRIO", counter: "HOJE", detail: "hoje", metric: "OPERAÇÕES HOJE" },
  SEMANAL: { button: "SEMANAL", counter: "SEMANA", detail: "nesta semana", metric: "OPERAÇÕES NA SEMANA" },
  MENSAL: { button: "MENSAL", counter: "MÊS", detail: "neste mês", metric: "OPERAÇÕES NO MÊS" },
};

export function nextOperationalPeriod(period: OperationalPeriod): OperationalPeriod {
  if (period === "DIARIO") return "SEMANAL";
  if (period === "SEMANAL") return "MENSAL";
  return "DIARIO";
}

export type OperationalPeriodWindow = {
  start: string;
  end: string;
  detailLabel: string;
  counterLabel: string;
};

function localDateKey(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OFFICE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function dateAtUtcNoon(dateKey: string) {
  return new Date(`${dateKey}T12:00:00.000Z`);
}

function dateKeyFromUtc(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(dateKey: string, days: number) {
  const date = dateAtUtcNoon(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKeyFromUtc(date);
}

function localStartIso(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000${OFFICE_OFFSET}`).toISOString();
}

export function operationalPeriodWindow(
  period: OperationalPeriod,
  now = new Date(),
): OperationalPeriodWindow {
  const today = localDateKey(now);
  let startKey = today;
  let endKey = addUtcDays(today, 1);

  if (period === "SEMANAL") {
    const dayOfWeek = dateAtUtcNoon(today).getUTCDay();
    startKey = addUtcDays(today, -((dayOfWeek + 6) % 7));
    endKey = addUtcDays(startKey, 7);
  } else if (period === "MENSAL") {
    startKey = `${today.slice(0, 7)}-01`;
    const start = dateAtUtcNoon(startKey);
    start.setUTCMonth(start.getUTCMonth() + 1);
    endKey = dateKeyFromUtc(start).slice(0, 7) + "-01";
  }

  return {
    start: localStartIso(startKey),
    end: localStartIso(endKey),
    detailLabel: OPERATIONAL_PERIOD_LABELS[period].detail,
    counterLabel: OPERATIONAL_PERIOD_LABELS[period].counter,
  };
}
