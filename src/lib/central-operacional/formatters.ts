import type { OperationalIndicator } from "./contracts";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 2,
});

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

export function formatOperationalIndicator(indicator: OperationalIndicator | null, hideValues: boolean) {
  if (!indicator) return "—";
  if (indicator.tipo === "MOEDA") return hideValues ? "R$ ••••••" : currency.format(indicator.valor);

  const value = Math.abs(indicator.valor) >= 10_000 ? compact.format(indicator.valor) : indicator.valor.toLocaleString("pt-BR");
  return indicator.sufixo ? `${value} ${indicator.sufixo}` : value;
}

export function formatOperationalEventValue(
  value: number | null,
  quantity: number | null,
  hideValues: boolean,
) {
  if (value !== null) return hideValues ? "R$ ••••••" : currency.format(value);
  if (quantity !== null) return `${quantity.toLocaleString("pt-BR")} un.`;
  return null;
}

export function relativeOperationalTime(iso: string, now: number) {
  const elapsed = Math.max(0, now - new Date(iso).getTime());
  if (elapsed < 5_000) return "agora";
  if (elapsed < 60_000) return `há ${Math.floor(elapsed / 1_000)}s`;
  if (elapsed < 3_600_000) return `há ${Math.floor(elapsed / 60_000)}min`;
  return `há ${Math.floor(elapsed / 3_600_000)}h`;
}
