const CNPJ_CANONICAL_PATTERN = /^[A-Z0-9]{12}[0-9]{2}$/;
const CNPJ_SEPARATORS_PATTERN = /[.\-\/\s]/g;

/**
 * Normaliza CNPJ sem destruir as letras introduzidas pelo CNPJ alfanumérico.
 *
 * Somente separadores conhecidos são removidos. Qualquer outro caractere fica
 * no resultado para que a validação o rejeite, em vez de corrigir o dado de
 * forma silenciosa.
 */
export function normalizeCnpj(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(CNPJ_SEPARATORS_PATTERN, "");
}

function cnpjCharacterValue(character: string): number {
  return character.charCodeAt(0) - 48;
}

function calculateDigit(base: string, weights: readonly number[]): number {
  const total = Array.from(base).reduce(
    (sum, character, index) => sum + cnpjCharacterValue(character) * weights[index],
    0,
  );
  const remainder = total % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** Valida CNPJ numérico ou alfanumérico pelo algoritmo oficial módulo 11. */
export function isValidCnpj(value: unknown): boolean {
  const cnpj = normalizeCnpj(value);
  if (!CNPJ_CANONICAL_PATTERN.test(cnpj)) return false;

  const base = cnpj.slice(0, 12);
  if (/^(.)\1{11}$/.test(base)) return false;

  const first = calculateDigit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calculateDigit(`${base}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return Number(cnpj[12]) === first && Number(cnpj[13]) === second;
}

export function formatCnpj(value: unknown): string {
  const canonical = normalizeCnpj(value).slice(0, 14);
  if (canonical.length <= 2) return canonical;
  if (canonical.length <= 5) return canonical.replace(/^(.{2})(.+)$/, "$1.$2");
  if (canonical.length <= 8) {
    return canonical.replace(/^(.{2})(.{3})(.+)$/, "$1.$2.$3");
  }
  if (canonical.length <= 12) {
    return canonical.replace(/^(.{2})(.{3})(.{3})(.+)$/, "$1.$2.$3/$4");
  }
  return canonical.replace(/^(.{2})(.{3})(.{3})(.{4})(.{1,2})$/, "$1.$2.$3/$4-$5");
}

export function assertValidCnpj(value: unknown): string {
  const canonical = normalizeCnpj(value);
  if (!isValidCnpj(canonical)) {
    throw new Error("CNPJ inválido.");
  }
  return canonical;
}

export const CNPJ_CANONICAL_LENGTH = 14;

