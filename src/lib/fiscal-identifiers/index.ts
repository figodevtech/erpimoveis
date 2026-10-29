export type FiscalDocument =
  | { kind: "CPF"; canonical: string; raw?: string }
  | { kind: "CNPJ"; canonical: string; raw?: string }
  | { kind: "ID_EXTERIOR"; canonical: string; raw?: string };

import { normalizeCnpj } from "./cnpj";

export {
  assertValidCnpj,
  CNPJ_CANONICAL_LENGTH,
  formatCnpj,
  isValidCnpj,
  normalizeCnpj,
} from "./cnpj";

export function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** CPF ou CNPJ formatado pela quantidade de dígitos; o resto volta como veio, sem espaços nas pontas. */
export function formatCpfCnpj(value: unknown): string {
  const digits = onlyDigits(value);
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  return String(value ?? "").trim();
}

export function normalizeCpf(value: unknown): string {
  return onlyDigits(value);
}

export function isValidCpf(value: unknown): boolean {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;

  const calculate = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cpf[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calculate(9) === Number(cpf[9]) && calculate(10) === Number(cpf[10]);
}

export function formatCpf(value: unknown): string {
  return normalizeCpf(value)
    .slice(0, 11)
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

export function normalizeForeignFiscalId(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

/** Normaliza um campo misto CPF/CNPJ sem aplicar a regra numérica ao CNPJ. */
export function normalizeCpfOrCnpj(value: unknown): string {
  const cnpj = normalizeCnpj(value);
  return /[A-Z]/.test(cnpj) || cnpj.length > 11 ? cnpj : normalizeCpf(value);
}

export function normalizeFiscalDocument(
  kind: FiscalDocument["kind"],
  value: unknown,
): FiscalDocument {
  const raw = String(value ?? "");
  if (kind === "CNPJ") {
    return { kind, canonical: normalizeCnpj(value), raw };
  }
  if (kind === "CPF") return { kind, canonical: normalizeCpf(value), raw };
  return { kind, canonical: normalizeForeignFiscalId(value), raw };
}
