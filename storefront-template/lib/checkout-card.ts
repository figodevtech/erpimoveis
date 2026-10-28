export interface CheckoutCard { holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string }
export const emptyCheckoutCard: CheckoutCard = { holderName: "", number: "", expiryMonth: "", expiryYear: "", ccv: "" };
export function parseCheckoutCard(value: unknown): CheckoutCard | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const card = { holderName: String(input.holderName || "").trim(), number: String(input.number || "").replace(/\D/g, ""), expiryMonth: String(input.expiryMonth || "").padStart(2, "0"), expiryYear: String(input.expiryYear || ""), ccv: String(input.ccv || "") };
  if (card.expiryYear.length === 2) card.expiryYear = `20${card.expiryYear}`;
  if (!card.holderName || card.holderName.length > 100 || !/^\d{13,19}$/.test(card.number) || !/^(0[1-9]|1[0-2])$/.test(card.expiryMonth) || !/^\d{4}$/.test(card.expiryYear) || !/^\d{3,4}$/.test(card.ccv)) return null;
  const expiry = new Date(Number(card.expiryYear), Number(card.expiryMonth), 1);
  if (expiry.getTime() <= Date.now()) return null;
  let sum = 0;
  for (let i = card.number.length - 1, double = false; i >= 0; i--, double = !double) {
    let digit = Number(card.number[i]);
    if (double) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0 ? card : null;
}
