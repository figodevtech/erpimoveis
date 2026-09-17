import type { FiscalDateValue } from "@/lib/fiscal-date";

export const SPED_COMPETENCIA_STATUSES = [
  "ABERTA",
  "EM_VALIDACAO",
  "COM_ERROS",
  "APTA",
  "FECHADA",
] as const;
export type SpedCompetenciaStatus = (typeof SPED_COMPETENCIA_STATUSES)[number];

export const SPED_VERSAO_STATUSES = [
  "RASCUNHO",
  "VALIDADA",
  "FECHADA",
  "SUBSTITUIDA",
] as const;
export type SpedVersaoStatus = (typeof SPED_VERSAO_STATUSES)[number];

export const SPED_GATE_STATUSES = ["PENDENTE", "CONFIRMADO", "NAO_APLICAVEL"] as const;
export type SpedGateStatus = (typeof SPED_GATE_STATUSES)[number];

export const SPED_DIAGNOSTIC_SEVERITIES = ["BLOQUEIO", "ERRO", "AVISO", "INFORMACAO"] as const;
export type SpedDiagnosticSeverity = (typeof SPED_DIAGNOSTIC_SEVERITIES)[number];

export type SpedSourceRef = {
  source: "XML" | "BANCO" | "CONFIGURACAO" | "IMPORTACAO" | "CALCULO" | "LANCAMENTO_MANUAL";
  table?: string;
  id?: string | number;
  documentKey?: string;
  xmlHash?: string;
  path?: string;
};

export type SpedDiagnostic = {
  code: string;
  severity: SpedDiagnosticSeverity;
  message: string;
  record?: string;
  field?: string;
  source?: SpedSourceRef;
  context?: Record<string, unknown>;
};

export type EfdFieldPrimitive = string | number | bigint | boolean | null | undefined;

export type EfdRecord = {
  code: string;
  values: Record<string, EfdFieldPrimitive | FiscalDateValue>;
  source?: SpedSourceRef;
};

export type EfdFieldType = "text" | "integer" | "decimal" | "date";

export type EfdFieldDefinition = {
  name: string;
  type?: EfdFieldType;
  required?: boolean;
  maxLength?: number;
  scale?: number;
};

export type EfdRecordDefinition = {
  code: string;
  fields: readonly EfdFieldDefinition[];
  block: "0" | "B" | "C" | "D" | "E" | "G" | "H" | "K" | "1" | "9";
};

export type EfdLayout = {
  code: string;
  validFrom: string;
  validUntil: string;
  records: ReadonlyMap<string, EfdRecordDefinition>;
};

export type SpedGateConfiguration = {
  profile: SpedGateStatus;
  blockK: SpedGateStatus;
  /** Obrigatoriedade apurada; `undefined` significa que a decisão ainda não foi registrada. */
  blockKRequired?: boolean;
  record1400: SpedGateStatus;
  record1400Applicable?: boolean;
  recordsC176C179: SpedGateStatus;
  recordsC176C179Applicable?: boolean;
  record1601: SpedGateStatus;
  record1601Applicable?: boolean;
  inventory: SpedGateStatus;
  inventoryApplicable?: boolean;
};

export type SpedConditionalEvidence = {
  hasInventoryRequirement?: boolean;
  hasBlockKEvidence?: boolean;
  hasRecord1400Evidence?: boolean;
  hasC176C179Evidence?: boolean;
  c176C179DocumentKeys?: string[];
  c176C179Requirements?: Array<{
    documentKey: string;
    requiredRecords: Array<"C176" | "C179">;
  }>;
};

export type SpedValidationCandidate = {
  competence: string;
  timezoneIana: string;
  gates: SpedGateConfiguration;
  conditionalEvidence?: SpedConditionalEvidence;
  records?: EfdRecord[];
  unconfirmedEntryIds?: number[];
};

export type SerializedEfd = {
  layout: string;
  text: string;
  bytes: Uint8Array;
  lineCount: number;
  recordCounts: Record<string, number>;
};
