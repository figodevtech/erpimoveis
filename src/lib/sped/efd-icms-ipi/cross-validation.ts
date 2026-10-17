import type { EfdRecord, SpedDiagnostic } from "./types";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function cents(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

/**
 * Consistência entre registros que o PVA confere e que a validação campo a
 * campo não enxerga: referências do Bloco 0, totais do C100 contra seus C190 e
 * a apuração do E110 contra os documentos.
 */
export function validateEfdCrossReferences(records: readonly EfdRecord[]): SpedDiagnostic[] {
  const diagnostics: SpedDiagnostic[] = [];
  const participants = new Set<string>();
  const referencedParticipants = new Set<string>();
  const items = new Map<string, { unit: string; conversions: Set<string> }>();
  let currentItem: string | null = null;

  for (const record of records) {
    if (record.code === "0150") participants.add(text(record.values.COD_PART));
    if (record.code === "0200") {
      currentItem = text(record.values.COD_ITEM);
      items.set(currentItem, { unit: text(record.values.UNID_INV), conversions: new Set() });
    } else if (record.code === "0220" && currentItem) {
      items.get(currentItem)?.conversions.add(text(record.values.UNID_CONV));
    } else if (record.code[0] !== "0") {
      currentItem = null;
    }
  }

  let c100: EfdRecord | null = null;
  let c190Icms = 0;
  let c190Base = 0;
  let debits = 0;
  let credits = 0;
  const closeDocument = () => {
    if (!c100 || ["02", "04"].includes(text(c100.values.COD_SIT))) return;
    const declaredIcms = cents(c100.values.VL_ICMS);
    const declaredBase = cents(c100.values.VL_BC_ICMS);
    if (declaredIcms !== c190Icms || declaredBase !== c190Base) diagnostics.push({
      code: "C100_DIVERGENTE_DOS_C190",
      severity: "BLOQUEIO",
      message: `O C100 ${text(c100.values.CHV_NFE) || text(c100.values.NUM_DOC)} informa base/ICMS ${(declaredBase / 100).toFixed(2)}/${(declaredIcms / 100).toFixed(2)}, mas os C190 somam ${(c190Base / 100).toFixed(2)}/${(c190Icms / 100).toFixed(2)}.`,
      record: "C100",
      source: c100.source,
    });
  };

  for (const record of records) {
    if (record.code === "C100") {
      closeDocument();
      c100 = record;
      c190Icms = 0;
      c190Base = 0;
      const participant = text(record.values.COD_PART);
      if (participant) {
        referencedParticipants.add(participant);
        if (!participants.has(participant)) diagnostics.push({
          code: "PARTICIPANTE_NAO_CADASTRADO",
          severity: "BLOQUEIO",
          message: `O C100 referencia o participante ${participant}, ausente do 0150.`,
          record: "C100",
          field: "COD_PART",
          source: record.source,
        });
      }
    } else if (record.code === "C170") {
      const code = text(record.values.COD_ITEM);
      const unit = text(record.values.UNID);
      const item = items.get(code);
      if (!item) diagnostics.push({
        code: "ITEM_NAO_CADASTRADO",
        severity: "BLOQUEIO",
        message: `O C170 referencia o item ${code}, ausente do 0200.`,
        record: "C170",
        field: "COD_ITEM",
        source: record.source,
      });
      else if (unit && unit !== item.unit && !item.conversions.has(unit)) diagnostics.push({
        code: "UNIDADE_CONVERSAO_AUSENTE",
        severity: "BLOQUEIO",
        message: `O item ${code} entrou em ${unit}, mas é controlado em ${item.unit}. Cadastre o fator de conversão ${unit} → ${item.unit} (0220).`,
        record: "0220",
        source: record.source,
        context: { itemCode: code, documentUnit: unit, inventoryUnit: item.unit },
      });
    } else if (record.code === "C190" && c100) {
      c190Icms += cents(record.values.VL_ICMS);
      c190Base += cents(record.values.VL_BC_ICMS);
      if (!["02", "04"].includes(text(c100.values.COD_SIT))) {
        if (text(c100.values.IND_OPER) === "1") debits += cents(record.values.VL_ICMS);
        else credits += cents(record.values.VL_ICMS);
      }
    } else if (record.code[0] !== "C") {
      closeDocument();
      c100 = null;
    }
    if (record.code === "E110") {
      if (cents(record.values.VL_TOT_DEBITOS) !== debits) diagnostics.push({
        code: "E110_DEBITOS_DIVERGENTES",
        severity: "BLOQUEIO",
        message: `E110.VL_TOT_DEBITOS é ${(cents(record.values.VL_TOT_DEBITOS) / 100).toFixed(2)}, mas os C190 de saída somam ${(debits / 100).toFixed(2)}.`,
        record: "E110",
        field: "VL_TOT_DEBITOS",
      });
      if (cents(record.values.VL_TOT_CREDITOS) !== credits) diagnostics.push({
        code: "E110_CREDITOS_DIVERGENTES",
        severity: "BLOQUEIO",
        message: `E110.VL_TOT_CREDITOS é ${(cents(record.values.VL_TOT_CREDITOS) / 100).toFixed(2)}, mas os C190 de entrada somam ${(credits / 100).toFixed(2)}.`,
        record: "E110",
        field: "VL_TOT_CREDITOS",
      });
    }
  }
  closeDocument();

  for (const participant of participants) {
    if (!referencedParticipants.has(participant) && !records.some((record) => record.code !== "0150" && Object.values(record.values).some((value) => text(value) === participant))) {
      diagnostics.push({
        code: "PARTICIPANTE_SEM_REFERENCIA",
        severity: "AVISO",
        message: `O participante ${participant} está no 0150 sem ser referenciado por nenhum registro.`,
        record: "0150",
      });
    }
  }
  return diagnostics;
}
