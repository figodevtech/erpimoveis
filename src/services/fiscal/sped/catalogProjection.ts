import type { EfdRecord, SpedDiagnostic, SpedSourceRef } from "@/lib/sped/efd-icms-ipi";

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

export type SpedEntryUnitUsage = {
  code: string;
  /** Unidade do C170 (a do XML). */
  documentUnit: string;
  /** UNID_INV do 0200. */
  inventoryUnit: string | null;
  documentQuantity: number;
  /** Quantidade que a entrada levou ao estoque, na unidade do estoque. */
  stockQuantity: number | null;
  source?: SpedSourceRef;
};

/**
 * Fator do 0220 tirado da própria entrada: quanto da unidade de estoque entrou
 * por unidade da nota. "PC" do fornecedor que entrou 1 para 1 como "UN" dá 1;
 * caixa que virou 10 unidades dá 10. Quantidade fracionada arredondada na
 * entrada (6,15 M → 6) é a mesma unidade, não conversão. Fator cadastrado à mão
 * prevalece; o mesmo item com fatores diferentes no mês fica para quem opera.
 */
export function deriveUnitConversions(input: {
  usages: readonly SpedEntryUnitUsage[];
  manual: readonly SpedUnitConversion[];
  competenceStart: string;
}): { conversions: SpedUnitConversion[]; diagnostics: SpedDiagnostic[] } {
  const covered = (code: string, origin: string, dest: string) => input.manual.some((conversion) =>
    text(conversion.unidadeOrigem) === origin
    && (text(conversion.codigoItem) === code || (!text(conversion.codigoItem) && text(conversion.unidadeDestino) === dest)));
  const factors = new Map<string, { usage: SpedEntryUnitUsage; values: Set<number> }>();
  for (const usage of input.usages) {
    const origin = text(usage.documentUnit);
    const dest = text(usage.inventoryUnit);
    const stock = number(usage.stockQuantity);
    if (!origin || !dest || origin === dest || covered(usage.code, origin, dest)) continue;
    if (!(usage.documentQuantity > 0) || !(stock > 0)) continue;
    const rounded = !Number.isInteger(usage.documentQuantity) && Math.round(usage.documentQuantity) === stock;
    const factor = Math.round((rounded ? 1 : stock / usage.documentQuantity) * 1_000_000) / 1_000_000;
    const key = `${usage.code}|${origin}`;
    const entry = factors.get(key) ?? { usage, values: new Set<number>() };
    entry.values.add(factor);
    factors.set(key, entry);
  }
  const conversions: SpedUnitConversion[] = [];
  const diagnostics: SpedDiagnostic[] = [];
  for (const { usage, values } of factors.values()) {
    const origin = text(usage.documentUnit);
    const dest = text(usage.inventoryUnit);
    if (values.size > 1) {
      diagnostics.push({
        code: "UNIDADE_CONVERSAO_DIVERGENTE",
        severity: "BLOQUEIO",
        message: `O item ${usage.code} entrou em ${origin} com fatores diferentes no mês (${Array.from(values).join(" e ")} ${dest} por ${origin}). Cadastre o fator de conversão ${origin} → ${dest}.`,
        record: "0220",
        source: usage.source,
        context: { itemCode: usage.code, documentUnit: origin, inventoryUnit: dest },
      });
      continue;
    }
    conversions.push({
      id: `entrada:${usage.code}:${origin}`,
      codigoItem: usage.code,
      unidadeOrigem: origin,
      unidadeDestino: dest,
      fatorConversao: Array.from(values)[0],
      vigenciaInicio: input.competenceStart,
    });
  }
  return { conversions, diagnostics };
}

/** Campos do 0200 que mudam a tributação: valores diferentes no mês pedem decisão. */
const ITEM_FISCAL_FIELDS: Record<string, string> = {
  COD_NCM: "NCM", CEST: "CEST", TIPO_ITEM: "tipo do item", UNID_INV: "unidade de estoque", ALIQ_ICMS: "alíquota de ICMS",
};

/**
 * O mesmo item em várias notas do mês. O 0200 sai do cadastro; o campo que o
 * cadastro não tem vem do XML, e cada fornecedor preenche o que quer. Nota que
 * não informa o campo não apaga o que as outras informaram, e descrição ou
 * código de barras diferentes ficam com a nota mais recente. NCM, CEST, tipo,
 * unidade ou alíquota realmente diferentes mudam a tributação: esses bloqueiam.
 */
export function mergeItemVersions(versions: ReadonlyArray<{ record: EfdRecord; date: string }>): {
  record: EfdRecord;
  diagnostics: SpedDiagnostic[];
} {
  const ordered = [...versions].sort((left, right) => left.date.localeCompare(right.date, "en"));
  const latest = ordered[ordered.length - 1].record;
  const values: EfdRecord["values"] = { ...latest.values };
  const conflicts: string[] = [];
  const fields = new Set(ordered.flatMap((version) => Object.keys(version.record.values)));
  for (const field of fields) {
    const informed = ordered.map((version) => version.record.values[field]).filter((value) => text(value) !== "");
    if (!informed.length) continue;
    values[field] = informed[informed.length - 1];
    const distinct = Array.from(new Set(informed.map(text)));
    if (distinct.length > 1 && ITEM_FISCAL_FIELDS[field]) conflicts.push(`${ITEM_FISCAL_FIELDS[field]} (${distinct.join(" e ")})`);
  }
  const code = text(latest.values.COD_ITEM);
  return {
    record: { ...latest, values },
    diagnostics: conflicts.length ? [{
      code: "CADASTRO_FISCAL_DIVERGENTE",
      severity: "BLOQUEIO",
      message: `O item ${code} aparece com ${conflicts.join(", ")} diferentes entre as notas do mês. Corrija o cadastro do item; ele prevalece sobre as notas.`,
      record: "0200",
      source: latest.source,
      context: { itemCode: code },
    }] : [],
  };
}

/** Campos do 0150 que o 0175 pode alterar, com o número do campo no leiaute (o 07, IE, não entra). */
const PARTICIPANT_CHANGEABLE_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["NOME", "03"], ["COD_PAIS", "04"], ["CNPJ", "05"], ["CPF", "06"], ["COD_MUN", "08"],
  ["SUFRAMA", "09"], ["END", "10"], ["NUM", "11"], ["COMPL", "12"], ["BAIRRO", "13"],
];

/** Zero à esquerda não muda a inscrição: 070670003 e 70670003 são a mesma IE. */
function normalizedIe(value: unknown): string {
  const raw = text(value).toUpperCase();
  return /^\d+$/.test(raw) ? raw.replace(/^0+/, "") : raw;
}

/**
 * O mesmo participante em várias notas do mês. O 0150 leva os dados da nota
 * mais recente e cada campo alterado no período gera um 0175 com a data da
 * alteração e o conteúdo anterior (Guia Prático, registro 0175). Campo que antes
 * estava vazio não tem conteúdo anterior a informar (CONT_ANT é obrigatório).
 * Mudança de IE exige outro participante e não cabe no 0175: essa bloqueia.
 */
export function mergeParticipantVersions(versions: ReadonlyArray<{ record: EfdRecord; date: string }>): {
  records: EfdRecord[];
  diagnostics: SpedDiagnostic[];
} {
  const ordered = [...versions].sort((left, right) => left.date.localeCompare(right.date, "en"));
  const latest = ordered[ordered.length - 1];
  const code = text(latest.record.values.COD_PART);
  const diagnostics: SpedDiagnostic[] = [];
  const inscriptions = Array.from(new Set(ordered.map((version) => normalizedIe(version.record.values.IE)).filter(Boolean)));
  if (inscriptions.length > 1) diagnostics.push({
    code: "CADASTRO_FISCAL_DIVERGENTE",
    severity: "BLOQUEIO",
    message: `O participante ${code} aparece com inscrições estaduais diferentes no mês (${inscriptions.join(" e ")}). Mudança de IE exige outro participante no 0150; confira o cadastro.`,
    record: "0150",
    source: latest.record.source,
  });

  const changes: EfdRecord[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < ordered.length; index += 1) {
    const before = ordered[index - 1].record.values;
    const after = ordered[index].record.values;
    for (const [field, number] of PARTICIPANT_CHANGEABLE_FIELDS) {
      const previous = text(before[field]);
      if (!previous || previous === text(after[field])) continue;
      const values = { DT_ALT: ordered[index].date, NR_CAMPO: number, CONT_ANT: previous.slice(0, 100) };
      const key = JSON.stringify(values);
      if (seen.has(key)) continue;
      seen.add(key);
      // documentKey liga o 0175 ao seu 0150 quando o Bloco 0 é reordenado.
      changes.push({ code: "0175", values, source: { source: "XML", ...ordered[index].record.source, documentKey: code } });
    }
  }

  // A IE da nota mais recente; se ela veio sem IE, a última informada no mês.
  const ie = [...ordered].reverse().map((version) => text(version.record.values.IE)).find(Boolean) ?? latest.record.values.IE;
  return { records: [{ ...latest.record, values: { ...latest.record.values, IE: ie } }, ...changes], diagnostics };
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
  const participantChanges = new Map<string, EfdRecord[]>();
  const units = new Map<string, EfdRecord>();
  const items = new Map<string, EfdRecord>();
  const otherRecords: EfdRecord[] = [];

  for (const record of input.baseCatalogRecords) {
    if (record.code === "0150") {
      const code = text(record.values.COD_PART);
      if (code && !participants.has(code)) participants.set(code, record);
    } else if (record.code === "0175") {
      const code = text(record.source?.documentKey);
      if (code) participantChanges.set(code, [...(participantChanges.get(code) ?? []), record]);
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

  // 1. Participantes (0150) ordenados por COD_PART, cada um seguido das suas alterações (0175)
  const sortedParticipants = Array.from(participants.values()).sort((a, b) =>
    text(a.values.COD_PART).localeCompare(text(b.values.COD_PART), "en"),
  );
  for (const participant of sortedParticipants) {
    resultCatalogRecords.push(participant, ...(participantChanges.get(text(participant.values.COD_PART)) ?? []));
  }

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
