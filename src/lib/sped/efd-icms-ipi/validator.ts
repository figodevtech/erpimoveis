import { isValidIanaTimezone } from "@/lib/fiscal-date";
import { isValidCnpj } from "@/lib/fiscal-identifiers";

import type {
  EfdLayout,
  EfdRecord,
  SpedDiagnostic,
  SpedValidationCandidate,
} from "./types";

const BLOCKING_GATES: Array<{
  key: keyof SpedValidationCandidate["gates"];
  code: string;
  label: string;
}> = [
  { key: "profile", code: "PERFIL_EFD_PENDENTE", label: "Perfil EFD" },
  { key: "blockK", code: "BLOCO_K_PENDENTE", label: "Bloco K" },
  { key: "record1400", code: "REGISTRO_1400_PENDENTE", label: "Registro 1400" },
  { key: "recordsC176C179", code: "REGISTROS_C176_C179_PENDENTES", label: "Registros C176/C179" },
  { key: "record1601", code: "REGISTRO_1601_PENDENTE", label: "Registro 1601" },
  { key: "inventory", code: "INVENTARIO_PENDENTE", label: "Inventário/Bloco H" },
];

import { recalculateBlockClosures } from "./serializer";

export function validateEfdRecords(records: readonly EfdRecord[], layout: EfdLayout): SpedDiagnostic[] {
  const diagnostics: SpedDiagnostic[] = [];
  const recordsToValidate = recalculateBlockClosures(records);

  recordsToValidate.forEach((record, index) => {
    const definition = layout.records.get(record.code);
    if (!definition) {
      diagnostics.push({
        code: "REGISTRO_FORA_DO_LEIAUTE",
        severity: "BLOQUEIO",
        message: `Registro ${record.code} não existe no leiaute ${layout.code}.`,
        record: record.code,
        source: record.source,
        context: { line: index + 1 },
      });
      return;
    }

    for (const field of definition.fields) {
      const value = record.values[field.name];
      if (field.required && (value === null || value === undefined || value === "")) {
        diagnostics.push({
          code: "CAMPO_OBRIGATORIO_AUSENTE",
          severity: "BLOQUEIO",
          message: `${record.code}.${field.name} é obrigatório.`,
          record: record.code,
          field: field.name,
          source: record.source,
          context: { line: index + 1 },
        });
      }
    }

    const cnpj = record.values.CNPJ;
    if (cnpj && !isValidCnpj(cnpj)) {
      diagnostics.push({
        code: "CNPJ_INVALIDO",
        severity: "BLOQUEIO",
        message: `${record.code}.CNPJ não é um CNPJ numérico ou alfanumérico válido.`,
        record: record.code,
        field: "CNPJ",
        source: record.source,
      });
    }
  });

  return diagnostics;
}

export function validateSpedCandidate(
  candidate: SpedValidationCandidate,
  layout: EfdLayout,
): SpedDiagnostic[] {
  const diagnostics: SpedDiagnostic[] = [];

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(candidate.competence)) {
    diagnostics.push({ code: "COMPETENCIA_INVALIDA", severity: "BLOQUEIO", message: "Competência deve usar AAAA-MM." });
  }
  if (!isValidIanaTimezone(candidate.timezoneIana)) {
    diagnostics.push({ code: "TIMEZONE_INVALIDA", severity: "BLOQUEIO", message: "Timezone IANA do estabelecimento é inválida." });
  }

  for (const gate of BLOCKING_GATES) {
    if (candidate.gates[gate.key] === "PENDENTE") {
      diagnostics.push({
        code: gate.code,
        severity: "BLOQUEIO",
        message: `${gate.label} ainda precisa de confirmação fiscal.`,
      });
    }
  }

  const evidence = candidate.conditionalEvidence;
  if (candidate.gates.blockK === "CONFIRMADO" && candidate.gates.blockKRequired === undefined) {
    diagnostics.push({ code: "BLOCO_K_DECISAO_AUSENTE", severity: "BLOQUEIO", message: "O gate do Bloco K foi confirmado sem registrar se ele é obrigatório." });
  }
  if (evidence?.hasBlockKEvidence && candidate.gates.blockKRequired !== true) {
    diagnostics.push({ code: "BLOCO_K_APLICABILIDADE_DETECTADA", severity: "BLOQUEIO", message: "Há indício de obrigatoriedade do Bloco K sem configuração confirmada." });
  }
  if (candidate.gates.blockKRequired === true) {
    const hasKDetail = (candidate.records ?? []).some((record) => /^K(?!001$|990$)/.test(record.code));
    if (!hasKDetail) diagnostics.push({ code: "BLOCO_K_REGISTROS_AUSENTES", severity: "BLOQUEIO", message: "Bloco K obrigatório, mas seus registros de movimento/estoque não foram gerados." });
  }

  if (candidate.gates.record1400 === "CONFIRMADO" && candidate.gates.record1400Applicable === undefined) {
    diagnostics.push({ code: "REGISTRO_1400_DECISAO_AUSENTE", severity: "BLOQUEIO", message: "O gate do 1400 foi confirmado sem decisão de aplicabilidade." });
  }
  if (evidence?.hasRecord1400Evidence && candidate.gates.record1400Applicable !== true) {
    diagnostics.push({ code: "REGISTRO_1400_APLICABILIDADE_DETECTADA", severity: "BLOQUEIO", message: "Há indício de aplicabilidade do 1400 sem configuração confirmada." });
  }
  if (candidate.gates.record1400Applicable === true && !(candidate.records ?? []).some((record) => record.code === "1400")) {
    diagnostics.push({ code: "REGISTRO_1400_AUSENTE", severity: "BLOQUEIO", message: "O 1400 foi confirmado como aplicável, mas não foi gerado." });
  }

  if (candidate.gates.recordsC176C179 === "CONFIRMADO" && candidate.gates.recordsC176C179Applicable === undefined) {
    diagnostics.push({ code: "C176_C179_DECISAO_AUSENTE", severity: "BLOQUEIO", message: "O gate C176/C179 foi confirmado sem decisão de aplicabilidade." });
  }
  if (evidence?.hasC176C179Evidence && candidate.gates.recordsC176C179Applicable !== true) {
    diagnostics.push({
      code: "C176_C179_APLICABILIDADE_DETECTADA",
      severity: "BLOQUEIO",
      message: "Há operação potencialmente sujeita a C176/C179 e a decisão fiscal não está confirmada.",
      context: { documentKeys: evidence.c176C179DocumentKeys ?? [] },
    });
  }
  if (candidate.gates.recordsC176C179Applicable === true) {
    const requirements = evidence?.c176C179Requirements ?? [];
    if (requirements.length === 0) {
      diagnostics.push({ code: "C176_C179_CLASSIFICACAO_DOCUMENTAL_AUSENTE", severity: "BLOQUEIO", message: "C176/C179 aplicáveis, mas nenhum documento foi classificado com os registros exigidos." });
    }
    for (const requirement of requirements) {
      for (const requiredCode of requirement.requiredRecords) {
        const found = (candidate.records ?? []).some(
          (record) => record.code === requiredCode && record.source?.documentKey === requirement.documentKey,
        );
        if (!found) diagnostics.push({
          code: "REGISTRO_CONDICIONAL_AUSENTE",
          severity: "BLOQUEIO",
          message: `${requiredCode} exigido para o documento ${requirement.documentKey}, mas não foi gerado.`,
          record: requiredCode,
          source: { source: "XML", documentKey: requirement.documentKey },
        });
      }
    }
  }
  if (candidate.gates.record1601 === "CONFIRMADO" && candidate.gates.record1601Applicable === undefined) {
    diagnostics.push({ code: "REGISTRO_1601_DECISAO_AUSENTE", severity: "BLOQUEIO", message: "O gate do 1601 foi confirmado sem decisão de aplicabilidade." });
  }
  if (candidate.gates.record1601Applicable === true && !(candidate.records ?? []).some((record) => record.code === "1601")) {
    diagnostics.push({ code: "REGISTRO_1601_AUSENTE", severity: "BLOQUEIO", message: "O 1601 foi confirmado como aplicável, mas nenhum CSV validado gerou o registro." });
  }
  if (candidate.gates.inventory === "CONFIRMADO" && candidate.gates.inventoryApplicable === undefined) {
    diagnostics.push({ code: "INVENTARIO_DECISAO_AUSENTE", severity: "BLOQUEIO", message: "O gate de inventário foi confirmado sem decisão de aplicabilidade." });
  }
  if (candidate.gates.inventoryApplicable === true && !(candidate.records ?? []).some((record) => record.code === "H005")) {
    diagnostics.push({ code: "INVENTARIO_REGISTROS_AUSENTES", severity: "BLOQUEIO", message: "Inventário aplicável, mas H005/H010 não foram gerados a partir de fechamento aprovado." });
  }
  for (const entryId of candidate.unconfirmedEntryIds ?? []) {
    diagnostics.push({
      code: "DATA_ENTRADA_FISCAL_NAO_CONFIRMADA",
      severity: "BLOQUEIO",
      message: `A entrada ${entryId} não possui data fiscal confirmada.`,
      source: { source: "BANCO", table: "entrada", id: entryId },
    });
  }

  diagnostics.push(...validateEfdRecords(candidate.records ?? [], layout));
  return diagnostics;
}

export function hasBlockingDiagnostics(diagnostics: readonly SpedDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "BLOQUEIO" || diagnostic.severity === "ERRO");
}
