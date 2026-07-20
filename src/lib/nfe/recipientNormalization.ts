import { sanitizeString } from "./xmlUtils";

export type FiscalRecipientInput = {
  clienteId?: number | null;
  tipoPessoa?: "FISICA" | "JURIDICA" | "ESTRANGEIRO";
  cpfCnpj?: string | null;
  nomeRazaoSocial?: string | null;
  indicadorIe?: string | null;
  inscricaoEstadual?: string | null;
  inscricaoMunicipal?: string | null;
  email?: string | null;
  telefone?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  codigoMunicipio?: string | null;
  codigoPais?: string | null;
  nomePais?: string | null;
};

export function onlyFiscalDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function hasRepeatedDigits(value: string) {
  return /^(\d)\1+$/.test(value);
}

export function isValidCpf(value: unknown) {
  const cpf = onlyFiscalDigits(value);
  if (cpf.length !== 11 || hasRepeatedDigits(cpf)) return false;

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

export function isValidCnpj(value: unknown) {
  const cnpj = onlyFiscalDigits(value);
  if (cnpj.length !== 14 || hasRepeatedDigits(cnpj)) return false;

  const calculate = (base: string, weights: number[]) => {
    const sum = base
      .split("")
      .reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const first = calculate(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calculate(`${cnpj.slice(0, 12)}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(cnpj[12]) && second === Number(cnpj[13]);
}

export function formatCpfCnpj(value: unknown) {
  const digits = onlyFiscalDigits(value).slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function formatFiscalCep(value: unknown) {
  return onlyFiscalDigits(value).slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");
}

export function normalizeFiscalText(value: unknown, uppercase = false) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return uppercase ? sanitizeString(normalized).toUpperCase() : normalized;
}

export function normalizeFiscalRecipient<T extends FiscalRecipientInput>(value: T) {
  const tipoPessoa = value.tipoPessoa ?? "JURIDICA";
  return {
    ...value,
    tipoPessoa,
    cpfCnpj: onlyFiscalDigits(value.cpfCnpj),
    nomeRazaoSocial: normalizeFiscalText(value.nomeRazaoSocial),
    indicadorIe: ["1", "2", "9"].includes(String(value.indicadorIe))
      ? String(value.indicadorIe)
      : "9",
    inscricaoEstadual: onlyFiscalDigits(value.inscricaoEstadual),
    inscricaoMunicipal: onlyFiscalDigits(value.inscricaoMunicipal),
    email: normalizeFiscalText(value.email).toLowerCase(),
    telefone: onlyFiscalDigits(value.telefone).slice(0, 14),
    endereco: normalizeFiscalText(value.endereco),
    numero: normalizeFiscalText(value.numero) || "S/N",
    complemento: normalizeFiscalText(value.complemento),
    bairro: normalizeFiscalText(value.bairro),
    cidade: normalizeFiscalText(value.cidade, true),
    estado: normalizeFiscalText(value.estado, true).slice(0, 2),
    cep: onlyFiscalDigits(value.cep).slice(0, 8),
    codigoMunicipio: onlyFiscalDigits(value.codigoMunicipio).slice(0, 7),
    codigoPais: onlyFiscalDigits(value.codigoPais) || "1058",
    nomePais: normalizeFiscalText(value.nomePais, true) || "BRASIL",
  };
}
