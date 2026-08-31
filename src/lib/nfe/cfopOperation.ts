export type NFeOperationDirection = "SAIDA" | "ENTRADA";

import { listCfopsForModel, validateCfopInCatalog } from "./cfopCatalog";
import { MODELO_NFE } from "./modeloDocumento";
import type {
  CfopCandidate,
  CfopCandidateOrigin,
  CfopResolution,
  CfopValidationResult,
} from "./cfopTypes";
import type { ModeloDocumentoFiscal } from "./types";

export type {
  CfopCandidate,
  CfopCandidateOrigin,
  CfopResolution,
  CfopValidationResult,
} from "./cfopTypes";

function normalizeUf(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

export function expectedCfopPrefix(
  operation: NFeOperationDirection,
  emitterUf?: string | null,
  partnerUf?: string | null,
) {
  const emitter = normalizeUf(emitterUf);
  const partner = normalizeUf(partnerUf);

  if (partner === "EX") return operation === "ENTRADA" ? "3" : "7";
  if (emitter && partner && emitter !== partner) {
    return operation === "ENTRADA" ? "2" : "6";
  }
  return operation === "ENTRADA" ? "1" : "5";
}

export function normalizeCfopForOperation(
  value: unknown,
  operation: NFeOperationDirection,
  emitterUf?: string | null,
  partnerUf?: string | null,
  modelo: ModeloDocumentoFiscal = MODELO_NFE,
) {
  const cfop = mapCfopPrefixForOperation(value, operation, emitterUf, partnerUf);
  if (!cfop) return "";
  const validation = validateCfopForEmission({
    value: cfop,
    modelo,
    operation,
    emitterUf,
    partnerUf,
  });
  return validation.valid ? cfop : "";
}

export function mapCfopPrefixForOperation(
  value: unknown,
  operation: NFeOperationDirection,
  emitterUf?: string | null,
  partnerUf?: string | null,
) {
  const cfop = onlyDigits(value);
  const prefix = expectedCfopPrefix(operation, emitterUf, partnerUf);
  if (!cfop) return "";
  if (cfop.length !== 4) return cfop;
  if (["1", "2", "3", "5", "6", "7"].includes(cfop[0])) {
    return `${prefix}${cfop.slice(1)}`;
  }
  return cfop;
}

export function validateCfopForEmission(input: {
  value: unknown;
  modelo: ModeloDocumentoFiscal;
  operation: NFeOperationDirection;
  emitterUf?: string | null;
  partnerUf?: string | null;
  at?: Date | string | null;
}): CfopValidationResult {
  const catalogValidation = validateCfopInCatalog({
    value: input.value,
    modelo: input.modelo,
    at: input.at,
  });
  if (!catalogValidation.valid) return catalogValidation;

  if (
    !isCfopCompatibleWithOperation(
      catalogValidation.cfop,
      input.operation,
      input.emitterUf,
      input.partnerUf,
    )
  ) {
    const sentido = input.operation === "ENTRADA" ? "entrada" : "saída";
    return {
      ...catalogValidation,
      valid: false,
      code: "OPERATION_MISMATCH",
      message: `CFOP ${catalogValidation.cfop} é incompatível com a operação de ${sentido} e a UF do parceiro.`,
    };
  }
  return catalogValidation;
}

export function listCfopsForEmission(input: {
  modelo: ModeloDocumentoFiscal;
  operation: NFeOperationDirection;
  emitterUf?: string | null;
  partnerUf?: string | null;
  at?: Date | string | null;
}) {
  const prefix = expectedCfopPrefix(input.operation, input.emitterUf, input.partnerUf);
  return listCfopsForModel(input.modelo, input.at).filter((entry) => entry.codigo.startsWith(prefix));
}

const ORIGIN_SOURCE_LABEL: Record<CfopCandidateOrigin, string> = {
  ENTRADA: "da entrada fiscal",
  PRODUTO: "do produto",
  PADRAO: "do padrão fiscal",
  OPERACAO_SAIDA: "da operação de saída",
};

function invalidReason(result: CfopValidationResult) {
  if (result.code === "NOT_FOUND") return "não existe";
  if (result.code === "NOT_ALLOWED_NFE") return "não é permitido em NF-e";
  if (result.code === "NOT_ALLOWED_MODEL") return "não é permitido para o modelo";
  if (result.code === "OPERATION_MISMATCH") return "é incompatível com a operação e a UF";
  return "é inválido";
}

export function resolveCfopForEmission(input: {
  candidates: CfopCandidate[];
  modelo: ModeloDocumentoFiscal;
  operation: NFeOperationDirection;
  emitterUf?: string | null;
  partnerUf?: string | null;
  at?: Date | string | null;
}): CfopResolution {
  const attempts = input.candidates.flatMap((candidate) => {
    const originalCfop = onlyDigits(candidate.value);
    if (!originalCfop) return [];
    const resolvedCfop = mapCfopPrefixForOperation(
      originalCfop,
      input.operation,
      input.emitterUf,
      input.partnerUf,
    );
    return [{
      origin: candidate.origin,
      originalCfop,
      resolvedCfop,
      validation: validateCfopForEmission({
        value: resolvedCfop,
        modelo: input.modelo,
        operation: input.operation,
        emitterUf: input.emitterUf,
        partnerUf: input.partnerUf,
        at: input.at,
      }),
    }];
  });
  const selectedIndex = attempts.findIndex((attempt) => attempt.validation.valid);
  const selected = selectedIndex >= 0 ? attempts[selectedIndex] : null;
  const rejectedBeforeSelection = selected ? attempts.slice(0, selectedIndex).find((attempt) => !attempt.validation.valid) : null;

  if (selected) {
    const warning = rejectedBeforeSelection
      ? `CFOP ${rejectedBeforeSelection.resolvedCfop}, derivado ${ORIGIN_SOURCE_LABEL[rejectedBeforeSelection.origin]}, ${invalidReason(rejectedBeforeSelection.validation)}; aplicado ${selected.resolvedCfop} ${ORIGIN_SOURCE_LABEL[selected.origin]}.`
      : null;
    return {
      cfop: selected.resolvedCfop,
      modelo: input.modelo,
      selectedOrigin: selected.origin,
      substituted: Boolean(rejectedBeforeSelection),
      warning,
      validation: selected.validation,
      attempts,
    };
  }

  const validation = attempts[0]?.validation ?? validateCfopForEmission({
    value: "",
    modelo: input.modelo,
    operation: input.operation,
    emitterUf: input.emitterUf,
    partnerUf: input.partnerUf,
    at: input.at,
  });
  return {
    cfop: "",
    modelo: input.modelo,
    selectedOrigin: null,
    substituted: false,
    warning: attempts.length
      ? `${attempts.map((attempt) => `CFOP ${attempt.resolvedCfop} ${ORIGIN_SOURCE_LABEL[attempt.origin]}: ${invalidReason(attempt.validation)}`).join("; ")}. Selecione um CFOP válido.`
      : null,
    validation,
    attempts,
  };
}

export function isCfopCompatibleWithOperation(
  value: unknown,
  operation: NFeOperationDirection,
  emitterUf?: string | null,
  partnerUf?: string | null,
) {
  const cfop = onlyDigits(value);
  if (cfop.length !== 4) return true;
  return cfop.startsWith(expectedCfopPrefix(operation, emitterUf, partnerUf));
}
