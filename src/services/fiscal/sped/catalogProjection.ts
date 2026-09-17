import type { EfdRecord, SpedDiagnostic } from "@/lib/sped/efd-icms-ipi";

type Row = Record<string, any>;

export type SpedUnitConversion = {
  id: string | number;
  codigoItem?: string | null;
  unidadeOrigem: string;
  unidadeDestino: string;
  fatorConversao: number;
  codigoBarra?: string | null;
  vigenciaInicio: string;
  vigenciaFim?: string | null;
};

export type SpedItemCorrelation = {
  id: string | number;
  codigoItemPrincipal: string;
  codigoItemAtomico: string;
  quantidade: number;
  vigenciaInicio: string;
  vigenciaFim?: string | null;
};

export type SpedItemHistoricalChange = {
  id: string | number;
  codigoItem: string;
  descricaoAnterior: string;
  dataInicio: string;
  dataFim: string;
  codigoAnterior?: string | null;
};

export type SpedCatalogProjectionResult = {
  catalogRecords: EfdRecord[];
  itemsWith0220: Set<string>;
  itemsWith0221: Set<string>;
  diagnostics: SpedDiagnostic[];
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Projeta e organiza os cadastros do Bloco 0 na hierarquia estrita do SPED Fiscal:
 * - 0150 ordenados por COD_PART
 * - 0190 ordenados por UNID (inclui unidades documentais, inventário e unidades convertidas do 0220)
 * - Para cada 0200 (ordenados por COD_ITEM):
 *     - 0200 (Item)
 *     - 0205 (Alterações do Item, se houver)
 *     - 0220 (Fatores de Conversão, se houver)
 *     - 0221 (Correlações com itens atômicos, se houver)
 */
export function projectSpedCatalog(input: {
  baseCatalogRecords: readonly EfdRecord[];
  unitConversions?: readonly SpedUnitConversion[];
  itemCorrelations?: readonly SpedItemCorrelation[];
  historicalChanges?: readonly SpedItemHistoricalChange[];
  competenceStart: string;
  competenceEnd: string;
}): SpedCatalogProjectionResult {
  const diagnostics: SpedDiagnostic[] = [];
  const itemsWith0220 = new Set<string>();
  const itemsWith0221 = new Set<string>();

  const participants = new Map<string, EfdRecord>();
  const units = new Map<string, EfdRecord>();
  const items = new Map<string, EfdRecord>();
  const otherRecords: EfdRecord[] = [];

  for (const record of input.baseCatalogRecords) {
    if (record.code === "0150") {
      const code = text(record.values.COD_PART);
      if (code && !participants.has(code)) participants.set(code, record);
    } else if (record.code === "0190") {
      const unit = text(record.values.UNID);
      if (unit && !units.has(unit)) units.set(unit, record);
    } else if (record.code === "0200") {
      const code = text(record.values.COD_ITEM);
      if (code && !items.has(code)) items.set(code, record);
    } else if (!["0205", "0220", "0221"].includes(record.code)) {
      otherRecords.push(record);
    }
  }

  // Mapear conversões de unidade (0220) ativas para a competência
  // Podem ser específicas por item (codigoItem preenchido) ou gerais por unidade (codigoItem nulo)
  const conversionsByItem = new Map<string, SpedUnitConversion[]>();
  const conversionsByDestUnit = new Map<string, SpedUnitConversion[]>();

  for (const conversion of input.unitConversions ?? []) {
    const origin = text(conversion.unidadeOrigem);
    const dest = text(conversion.unidadeDestino);
    const factor = number(conversion.fatorConversao);

    if (!origin || !dest) continue;

    if (factor <= 0) {
      diagnostics.push({
        code: "0220_FATOR_CONVERSAO_INVALIDO",
        severity: "BLOQUEIO",
        message: `Fator de conversão entre ${origin} e ${dest} deve ser maior que zero.`,
        record: "0220",
        field: "FAT_CONV",
        source: { source: "CONFIGURACAO", table: "fiscal_sped_unidade_conversao", id: conversion.id },
      });
      continue;
    }

    const itemCode = text(conversion.codigoItem);
    if (itemCode) {
      const current = conversionsByItem.get(itemCode) ?? [];
      current.push(conversion);
      conversionsByItem.set(itemCode, current);
    } else {
      const current = conversionsByDestUnit.get(dest) ?? [];
      current.push(conversion);
      conversionsByDestUnit.set(dest, current);
    }

    // Toda unidade comercial usada em 0220 precisa existir no 0190
    if (!units.has(origin)) {
      units.set(origin, {
        code: "0190",
        values: { UNID: origin, DESCR: origin },
        source: { source: "CONFIGURACAO", table: "fiscal_sped_unidade_conversao", id: conversion.id },
      });
    }
  }

  // Mapear correlações de itens (0221) ativas para a competência
  const correlationsByItem = new Map<string, SpedItemCorrelation[]>();
  for (const correlation of input.itemCorrelations ?? []) {
    const parentCode = text(correlation.codigoItemPrincipal);
    const atomicCode = text(correlation.codigoItemAtomico);
    const quantity = number(correlation.quantidade);

    if (!parentCode || !atomicCode) continue;

    if (quantity <= 0) {
      diagnostics.push({
        code: "0221_QUANTIDADE_INVALIDA",
        severity: "BLOQUEIO",
        message: `Quantidade do item atômico ${atomicCode} contida no item ${parentCode} deve ser maior que zero.`,
        record: "0221",
        field: "QTD_CONTIDA",
        source: { source: "CONFIGURACAO", table: "fiscal_sped_item_correlacao", id: correlation.id },
      });
      continue;
    }

    const current = correlationsByItem.get(parentCode) ?? [];
    current.push(correlation);
    correlationsByItem.set(parentCode, current);
  }

  // Mapear alterações históricas (0205)
  const changesByItem = new Map<string, SpedItemHistoricalChange[]>();
  for (const change of input.historicalChanges ?? []) {
    const itemCode = text(change.codigoItem);
    if (!itemCode) continue;
    const current = changesByItem.get(itemCode) ?? [];
    current.push(change);
    changesByItem.set(itemCode, current);
  }

  // Montar registros finais ordenados hierarquicamente
  const resultCatalogRecords: EfdRecord[] = [];

  // 1. Participantes (0150) ordenados por COD_PART
  const sortedParticipants = Array.from(participants.values()).sort((a, b) =>
    text(a.values.COD_PART).localeCompare(text(b.values.COD_PART), "en"),
  );
  resultCatalogRecords.push(...sortedParticipants);

  // 2. Unidades (0190) ordenadas por UNID
  const sortedUnits = Array.from(units.values()).sort((a, b) =>
    text(a.values.UNID).localeCompare(text(b.values.UNID), "en"),
  );
  resultCatalogRecords.push(...sortedUnits);

  // 3. Itens (0200) ordenados por COD_ITEM com seus filhos aninhados imediatamente
  const sortedItems = Array.from(items.values()).sort((a, b) =>
    text(a.values.COD_ITEM).localeCompare(text(b.values.COD_ITEM), "en"),
  );

  for (const itemRecord of sortedItems) {
    const itemCode = text(itemRecord.values.COD_ITEM);
    const itemUnit = text(itemRecord.values.UNID_INV);

    resultCatalogRecords.push(itemRecord);

    // 3.1 Filhos 0205 (Alterações do Item)
    const historical = changesByItem.get(itemCode) ?? [];
    historical.sort((a, b) => a.dataInicio.localeCompare(b.dataInicio, "en"));
    for (const change of historical) {
      resultCatalogRecords.push({
        code: "0205",
        values: {
          DESCR_ANT_ITEM: change.descricaoAnterior,
          DT_INI: change.dataInicio,
          DT_FIM: change.dataFim,
          COD_ANT_ITEM: change.codigoAnterior || null,
        },
        source: { source: "CONFIGURACAO", table: "fiscal_sped_item_config", id: change.id },
      });
    }

    // 3.2 Filhos 0220 (Fatores de Conversão de Unidades)
    // Coleta conversões específicas do item e conversões gerais da unidade de estoque do item
    const itemSpecificConversions = conversionsByItem.get(itemCode) ?? [];
    const unitGeneralConversions = (conversionsByDestUnit.get(itemUnit) ?? []).filter(
      (conv) => !itemSpecificConversions.some((spec) => text(spec.unidadeOrigem) === text(conv.unidadeOrigem)),
    );
    const applicableConversions = [...itemSpecificConversions, ...unitGeneralConversions];

    if (applicableConversions.length > 0) {
      itemsWith0220.add(itemCode);
      applicableConversions.sort((a, b) => text(a.unidadeOrigem).localeCompare(text(b.unidadeOrigem), "en"));

      for (const conversion of applicableConversions) {
        resultCatalogRecords.push({
          code: "0220",
          values: {
            UNID_CONV: text(conversion.unidadeOrigem),
            FAT_CONV: Math.round(number(conversion.fatorConversao) * 1000000) / 1000000,
            COD_BARRA: text(conversion.codigoBarra) || null,
          },
          source: { source: "CONFIGURACAO", table: "fiscal_sped_unidade_conversao", id: conversion.id, documentKey: itemCode },
        });
      }
    }

    // 3.3 Filhos 0221 (Correlação entre Itens - kits / itens compostos)
    const correlations = correlationsByItem.get(itemCode) ?? [];
    if (correlations.length > 0) {
      itemsWith0221.add(itemCode);
      correlations.sort((a, b) => a.codigoItemAtomico.localeCompare(b.codigoItemAtomico, "en"));

      for (const correlation of correlations) {
        // Verificar se o item atômico componente existe no 0200
        if (!items.has(correlation.codigoItemAtomico)) {
          diagnostics.push({
            code: "0221_ITEM_ATOMICO_NAO_CADASTRADO",
            severity: "BLOQUEIO",
            message: `O item atômico ${correlation.codigoItemAtomico} referenciado no 0221 do item ${itemCode} não consta na tabela de itens (0200) da competência.`,
            record: "0221",
            field: "COD_ITEM_ATOMICO",
            source: { source: "CONFIGURACAO", table: "fiscal_sped_item_correlacao", id: correlation.id },
            context: { parentItem: itemCode, atomicItem: correlation.codigoItemAtomico },
          });
        }

        resultCatalogRecords.push({
          code: "0221",
          values: {
            COD_ITEM_ATOMICO: correlation.codigoItemAtomico,
            QTD_CONTIDA: Math.round(number(correlation.quantidade) * 1000000) / 1000000,
          },
          source: { source: "CONFIGURACAO", table: "fiscal_sped_item_correlacao", id: correlation.id, documentKey: itemCode },
        });
      }
    }
  }

  // 4. Outros registros cadastrais (se houver, e.g. 0450)
  resultCatalogRecords.push(...otherRecords);

  return {
    catalogRecords: resultCatalogRecords,
    itemsWith0220,
    itemsWith0221,
    diagnostics,
  };
}
