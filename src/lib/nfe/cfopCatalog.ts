import { CFOP_CATALOG, CFOP_CATALOG_SOURCE } from "./cfopCatalog.generated";
import { MODELO_NFCE } from "./modeloDocumento";
import type { CfopCatalogEntry, CfopValidationResult } from "./cfopTypes";
import type { ModeloDocumentoFiscal } from "./types";

export type { CfopCatalogEntry, CfopValidationResult } from "./cfopTypes";

export const CFOP_CATALOG_VERSION = CFOP_CATALOG_SOURCE.versao;
export const CFOP_CATALOG_EFFECTIVE_FROM = CFOP_CATALOG_SOURCE.vigencia;

// Regra I08-150 do MOC 7.0: lista de CFOP admitidos no modelo 65.
export const CFOPS_PERMITIDOS_NFCE = new Set([
  "5101",
  "5102",
  "5103",
  "5104",
  "5115",
  "5405",
  "5656",
  "5667",
  "5933",
]);

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function dateKey(value?: Date | string | null) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function vigenteEm(entry: CfopCatalogEntry, at: string) {
  return entry.inicioVigencia <= at && (!entry.fimVigencia || entry.fimVigencia >= at);
}

export function getCfopCatalogEntry(
  value: unknown,
  at?: Date | string | null,
): CfopCatalogEntry | null {
  const cfop = onlyDigits(value);
  if (cfop.length !== 4) return null;
  const targetDate = dateKey(at);
  return (
    CFOP_CATALOG.find((entry) => entry.codigo === cfop && vigenteEm(entry, targetDate)) ?? null
  );
}

export function validateCfopInCatalog(input: {
  value: unknown;
  modelo: ModeloDocumentoFiscal;
  at?: Date | string | null;
}): CfopValidationResult {
  const raw = String(input.value ?? "").trim();
  const cfop = onlyDigits(input.value);

  if (!raw) {
    return {
      valid: false,
      code: "REQUIRED",
      cfop: "",
      message: "Informe o CFOP.",
      entry: null,
    };
  }
  if (!/^\d{4}$/.test(raw)) {
    return {
      valid: false,
      code: "INVALID_FORMAT",
      cfop,
      message: "O CFOP deve ter exatamente 4 dígitos.",
      entry: null,
    };
  }

  const entry = getCfopCatalogEntry(cfop, input.at);
  if (!entry) {
    return {
      valid: false,
      code: "NOT_FOUND",
      cfop,
      message: `CFOP ${cfop} não existe na tabela vigente da NF-e.`,
      entry: null,
    };
  }
  if (!entry.indNFe) {
    return {
      valid: false,
      code: "NOT_ALLOWED_NFE",
      cfop,
      message: `CFOP ${cfop} não é permitido em NF-e.`,
      entry,
    };
  }
  if (input.modelo === MODELO_NFCE && !CFOPS_PERMITIDOS_NFCE.has(cfop)) {
    return {
      valid: false,
      code: "NOT_ALLOWED_MODEL",
      cfop,
      message: `CFOP ${cfop} não é permitido em NFC-e.`,
      entry,
    };
  }

  return { valid: true, code: "VALID", cfop, message: null, entry };
}

export function listCfopsForModel(
  modelo: ModeloDocumentoFiscal,
  at?: Date | string | null,
): CfopCatalogEntry[] {
  const targetDate = dateKey(at);
  return CFOP_CATALOG.filter(
    (entry) =>
      vigenteEm(entry, targetDate) &&
      entry.indNFe &&
      (modelo !== MODELO_NFCE || CFOPS_PERMITIDOS_NFCE.has(entry.codigo)),
  );
}
