export type NFeOperationDirection = "SAIDA" | "ENTRADA";

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
) {
  const cfop = onlyDigits(value);
  const prefix = expectedCfopPrefix(operation, emitterUf, partnerUf);
  if (!cfop) return `${prefix}102`;
  if (cfop.length !== 4) return cfop;
  if (["1", "2", "3", "5", "6", "7"].includes(cfop[0])) {
    return `${prefix}${cfop.slice(1)}`;
  }
  return cfop;
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
