export type FinancialSurchargeType = "FIXO" | "PORCENTAGEM" | null;

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const roundMoney = (value: number) =>
  Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

export function calculateFinancialSurcharge(
  commercialTotal: unknown,
  type: FinancialSurchargeType | string | undefined,
  value: unknown,
) {
  const base = Math.max(0, toNumber(commercialTotal));
  const amount = Math.max(0, toNumber(value));
  if (!type || amount <= 0 || base <= 0) return 0;
  if (type === "PORCENTAGEM") {
    return roundMoney(base * (Math.min(amount, 100) / 100));
  }
  return type === "FIXO" ? roundMoney(amount) : 0;
}

export function calculateFinancialTotal(
  commercialTotal: unknown,
  type: FinancialSurchargeType | string | undefined,
  value: unknown,
) {
  const base = Math.max(0, toNumber(commercialTotal));
  return roundMoney(base + calculateFinancialSurcharge(base, type, value));
}

export function sanitizeFinancialSurchargeType(value: unknown): FinancialSurchargeType {
  return value === "FIXO" || value === "PORCENTAGEM" ? value : null;
}
