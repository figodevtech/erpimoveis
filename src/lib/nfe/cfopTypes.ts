import type { ModeloDocumentoFiscal } from "./types";

export type CfopCatalogEntry = {
  codigo: string;
  descricao: string;
  inicioVigencia: string;
  fimVigencia: string | null;
  indNFe: boolean;
  indComunica: boolean;
  indTransp: boolean;
  indDevol: boolean;
  indRetor: boolean;
  indAnula: boolean;
  indRemes: boolean;
  indComb: boolean;
  /** Indicador oficial desde o IT 2023.002 v2.00. Só catalogado: nenhuma regra do ERP o lê ainda. */
  indExcIBSCBS: boolean;
};

export type CfopValidationCode =
  | "VALID"
  | "REQUIRED"
  | "INVALID_FORMAT"
  | "NOT_FOUND"
  | "NOT_ALLOWED_NFE"
  | "NOT_ALLOWED_MODEL"
  | "OPERATION_MISMATCH";

export type CfopValidationResult = {
  valid: boolean;
  code: CfopValidationCode;
  cfop: string;
  message: string | null;
  entry: CfopCatalogEntry | null;
};

export type CfopCandidateOrigin = "ENTRADA" | "PRODUTO" | "PADRAO" | "OPERACAO_SAIDA";

export type CfopCandidate = {
  value: string | number | null;
  origin: CfopCandidateOrigin;
};

export type CfopResolutionAttempt = {
  origin: CfopCandidateOrigin;
  originalCfop: string;
  resolvedCfop: string;
  validation: CfopValidationResult;
};

export type CfopResolution = {
  cfop: string;
  modelo: ModeloDocumentoFiscal;
  selectedOrigin: CfopCandidateOrigin | null;
  substituted: boolean;
  warning: string | null;
  validation: CfopValidationResult;
  attempts: CfopResolutionAttempt[];
};
