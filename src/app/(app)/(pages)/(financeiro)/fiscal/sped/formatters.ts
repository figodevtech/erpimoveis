const CURRENCY = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const INTEGER = new Intl.NumberFormat("pt-BR");

export function formatCurrency(value: number | null | undefined) {
  return CURRENCY.format(Number.isFinite(value) ? Number(value) : 0);
}

export function formatInteger(value: number | null | undefined) {
  return INTEGER.format(Number.isFinite(value) ? Number(value) : 0);
}

export function formatCompetencia(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? `${match[2]}/${match[1]}` : value;
}

export function formatCivilDate(value: string | null | undefined) {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

export function formatTimestamp(value: string | null | undefined, timeZone?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: timeZone || undefined,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  }
}

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: index === 0 ? 0 : 1 })} ${units[index]}`;
}

export function formatEnum(value: string | null | undefined) {
  if (!value) return "—";
  const normalized = value.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
  return normalized.charAt(0).toLocaleUpperCase("pt-BR") + normalized.slice(1);
}
