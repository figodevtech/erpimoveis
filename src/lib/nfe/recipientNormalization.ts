import { sanitizeString } from "./xmlUtils";
import {
  formatCnpj,
  formatCpf,
  isValidCnpj as validateCnpj,
  isValidCpf as validateCpf,
  normalizeCnpj,
  normalizeCpf,
} from "@/lib/fiscal-identifiers";

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

export function hasValidCpfCnpjLength(value: unknown) {
  const raw = String(value ?? "");
  return normalizeCpf(raw).length === 11 || normalizeCnpj(raw).length === 14;
}

export function isValidCpf(value: unknown) {
  return validateCpf(value);
}

export function isValidCnpj(value: unknown) {
  return validateCnpj(value);
}

export function formatCpfCnpj(value: unknown) {
  const cnpj = normalizeCnpj(value);
  return cnpj.length > 11 || /[A-Z]/.test(cnpj) ? formatCnpj(cnpj) : formatCpf(value);
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
  const documento =
    tipoPessoa === "FISICA"
      ? normalizeCpf(value.cpfCnpj)
      : tipoPessoa === "JURIDICA"
        ? normalizeCnpj(value.cpfCnpj)
        : normalizeFiscalText(value.cpfCnpj, true);
  return {
    ...value,
    tipoPessoa,
    cpfCnpj: documento,
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
