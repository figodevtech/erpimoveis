import "server-only";

import {
  endOfCompetence,
  isCivilDateInCompetence,
  parseCompetence,
  parseFiscalDate,
} from "@/lib/fiscal-date";
import type { SpedDiagnostic } from "@/lib/sped/efd-icms-ipi";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import type { SpedItemCorrelation, SpedUnitConversion } from "./catalogProjection";
import { effectiveSpedConfig, type SpedConfigVigencia } from "./configPolicies";
import type { SpedProductMaster } from "./documentProjection";
import {
  isConfirmedFiscalDateInCompetence,
  isPendingFiscalDateCandidateForCompetence,
  isSpedFiscalEntryCandidate,
} from "./entryScope";
import { throwIfSupabaseError } from "./errors";
import { civilDateInTimezone } from "./guards";
import { fetchAllByIds, fetchAllPages, type SpedCollectionReport } from "./sourcePagination";

type Row = Record<string, any>;

/** Valores de enum_status_nfe que o motor escritura a partir do XML. */
export const SETTLED_NOTE_STATUSES = ["AUTORIZADA", "CANCELADA", "DENEGADA"] as const;
/** Existem na SEFAZ ou podem existir, mas sem desfecho: bloqueiam em vez de sumir do arquivo. */
export const UNSETTLED_NOTE_STATUSES = ["ENVIADA", "CONTINGENCIA", "RESULTADO_INCERTO"] as const;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function month(value: unknown): string {
  return text(value).slice(0, 7);
}

export function shiftCivilDate(value: string, days: number): string {
  const [year, monthValue, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthValue - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function fiscalEmissionCivilDate(row: Row): string | null {
  const xml = text(row.xml_autorizado || row.xml_assinado);
  const lexical = /<(?:\w+:)?(?:dhEmi|dEmi)>\s*([^<]+)\s*<\/(?:\w+:)?(?:dhEmi|dEmi)>/i.exec(xml)?.[1];
  return parseFiscalDate(lexical)?.civilDate ?? null;
}

function vigente(builder: any, start: string, end: string) {
  return builder.lte("vigencia_inicio", end).or(`vigencia_fim.is.null,vigencia_fim.gte.${start}`);
}

/**
 * Entre os registros de DF-e de uma chave (resumo, XML completo, eventos),
 * escolhe o XML completo autorizado. Um resumo não carrega itens nem tributos.
 */
export function preferCompleteDfe(rows: readonly Row[]): Row | null {
  const complete = rows.filter((row) => /<(?:\w+:)?infNFe\b/i.test(text(row.xml)));
  const pool = complete.length ? complete : rows;
  return [...pool].sort((left, right) => {
    const leftProc = /^procNFe/i.test(text(left.schema)) ? 0 : 1;
    const rightProc = /^procNFe/i.test(text(right.schema)) ? 0 : 1;
    return leftProc - rightProc || number(right.id) - number(left.id);
  })[0] ?? null;
}

export async function loadEffectiveConfig(companyId: number, competenceStart: string): Promise<Row | null> {
  const [vigencias, current] = await Promise.all([
    supabaseAdmin.from("fiscal_sped_config_vigencia").select("vigencia_inicio, payload").eq("empresa_id", companyId).order("vigencia_inicio"),
    supabaseAdmin.from("fiscal_sped_config").select("*").eq("empresa_id", companyId).maybeSingle(),
  ]);
  // Banco sem a migration de vigências: a configuração corrente vale para todas as competências.
  if (vigencias.error && !/fiscal_sped_config_vigencia/.test(vigencias.error.message ?? "")) throwIfSupabaseError(vigencias.error);
  throwIfSupabaseError(current.error);
  const rows = vigencias.error ? [] : (vigencias.data ?? []) as SpedConfigVigencia[];
  const effective = effectiveSpedConfig(competenceStart, rows, current.data ?? null);
  return effective ? { ...effective, empresa_id: companyId } : null;
}

export async function collectSpedSources(competence: Row) {
  const competenceText = month(competence.competencia);
  const { start } = parseCompetence(competenceText);
  const end = endOfCompetence(competenceText);
  const noteQueryStart = shiftCivilDate(start, -2);
  const noteQueryEnd = shiftCivilDate(end, 2);
  const companyId = number(competence.empresa_id);
  const collection: SpedCollectionReport[] = [];
  const track = <T>(result: { rows: T[]; report: SpedCollectionReport }) => {
    collection.push(result.report);
    return result.rows;
  };

  const [companyResult, config, accountantResult, priorEfdResult, paymentImportsResult] = await Promise.all([
    supabaseAdmin.from("empresa").select("id, cnpj, razaosocial, nomefantasia, inscricaoestadual, inscricaomunicipal, endereco, codigomunicipio, bairro, numero, complemento, cep, uf, telefone").eq("id", companyId).maybeSingle(),
    loadEffectiveConfig(companyId, start),
    vigente(supabaseAdmin.from("fiscal_sped_contabilista").select("*").eq("empresa_id", companyId), start, end).order("vigencia_inicio", { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("fiscal_sped_efd_anterior_importacao").select("id, competencia_arquivo, arquivo_sha256, status, cabecalho, saldos_apuracao").eq("competencia_id", competence.id).eq("status", "VALIDADA").order("imported_at", { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("fiscal_sped_1601_importacao").select("id, arquivo_sha256, imported_at").eq("competencia_id", competence.id).eq("status", "VALIDADA").order("imported_at", { ascending: false }),
  ]);
  throwIfSupabaseError(companyResult.error);
  throwIfSupabaseError(accountantResult.error);
  throwIfSupabaseError(priorEfdResult.error);
  throwIfSupabaseError(paymentImportsResult.error);

  // Janela de ±2 dias pela coluna timestamptz; o recorte fiscal usa a data civil lexical do XML.
  const [rawNotes, rawEntries, rawUndated, adjustments] = await Promise.all([
    fetchAllPages<Row>("NF-e/NFC-e emitidas", ({ from, to }) => supabaseAdmin
      .from("nfe")
      .select("id, chave_acesso, status, modelo, dataemissao, xml_autorizado, xml_assinado", { count: "exact" })
      .eq("empresaid", companyId).eq("is_deleted", false).eq("ambiente", "PRODUCAO")
      .gte("dataemissao", `${noteQueryStart}T00:00:00`).lte("dataemissao", `${noteQueryEnd}T23:59:59.999`)
      .in("status", [...SETTLED_NOTE_STATUSES, ...UNSETTLED_NOTE_STATUSES])
      .order("id").range(from, to)).then(track),
    fetchAllPages<Row>("entradas com data fiscal na competência", ({ from, to }) => supabaseAdmin
      .from("entrada")
      .select("id, status, data_entrada_fiscal, fiscal_dfe_documento_id, notachave, fiscal, origem, tipo", { count: "exact" })
      .eq("status", "CONFIRMADA").gte("data_entrada_fiscal", start).lte("data_entrada_fiscal", end)
      .order("id").range(from, to)).then(track),
    // Sem data fiscal e criadas a partir da competência: candidatas a pendência
    // (criadas no mês) ou a aviso (emitidas no mês e registradas depois).
    fetchAllPages<Row>("entradas sem data fiscal", ({ from, to }) => supabaseAdmin
      .from("entrada")
      .select("id, status, fiscal, origem, tipo, notachave, fiscal_dfe_documento_id, created_at, data_emissao, data_entrada_fiscal, dfe:fiscal_dfe_documento_id(data_emissao)", { count: "exact" })
      .eq("status", "CONFIRMADA").is("data_entrada_fiscal", null).gte("created_at", `${shiftCivilDate(start, -1)}T00:00:00`)
      .order("id").range(from, to)).then(track),
    fetchAllPages<Row>("ajustes de apuração", ({ from, to }) => supabaseAdmin
      .from("fiscal_sped_ajuste_apuracao").select("*", { count: "exact" })
      .eq("competencia_id", competence.id).eq("ativo", true).order("id").range(from, to)).then(track),
  ]);

  const periodNoteRows = rawNotes.filter((row) => {
    const civilDate = fiscalEmissionCivilDate(row);
    if (civilDate) return isCivilDateInCompetence(civilDate, competenceText);
    return month(row.dataemissao) === competenceText;
  });
  const isSettled = (row: Row) => (SETTLED_NOTE_STATUSES as readonly string[]).includes(text(row.status));
  const noteRows = periodNoteRows.filter(isSettled);
  const unsettledNoteRows = periodNoteRows.filter((row) => !isSettled(row));
  const entryRows = rawEntries.filter((row) =>
    isSpedFiscalEntryCandidate(row) && isConfirmedFiscalDateInCompetence(row, { start, end }),
  );

  const directDfeIds = Array.from(new Set(entryRows.map((row) => number(row.fiscal_dfe_documento_id)).filter(Boolean)));
  const missingDfeKeys = Array.from(new Set(entryRows
    .filter((row) => !row.fiscal_dfe_documento_id && text(row.notachave).length === 44)
    .map((row) => text(row.notachave))));
  const dfeColumns = "id, empresa_id, chave_acesso, schema, xml, status, data_emissao";
  const [directDfeRows, recoveredDfeRows] = await Promise.all([
    fetchAllByIds<Row, number>("DF-e vinculados às entradas", directDfeIds, (ids, { from, to }) => supabaseAdmin
      .from("fiscal_dfe_documento").select(dfeColumns, { count: "exact" }).in("id", ids).order("id").range(from, to)).then(track),
    fetchAllByIds<Row, string>("DF-e recuperados pela chave", missingDfeKeys, (keys, { from, to }) => supabaseAdmin
      .from("fiscal_dfe_documento").select(dfeColumns, { count: "exact" }).in("chave_acesso", keys).order("id").range(from, to)).then(track),
  ]);
  const dfeRows = [...directDfeRows, ...recoveredDfeRows];
  const foreignDfeRows = dfeRows.filter((row) => number(row.empresa_id) !== companyId);
  const ownDfeRows = dfeRows.filter((row) => number(row.empresa_id) === companyId);
  const dfeById = new Map(ownDfeRows.map((row) => [number(row.id), row]));
  const dfeRowsByKey = new Map<string, Row[]>();
  for (const row of ownDfeRows) {
    const key = text(row.chave_acesso);
    if (key) dfeRowsByKey.set(key, [...(dfeRowsByKey.get(key) ?? []), row]);
  }
  const dfeByKey = new Map(Array.from(dfeRowsByKey.entries()).map(([key, rows]) => [key, preferCompleteDfe(rows)]));

  for (const row of entryRows) {
    if (!row.fiscal_dfe_documento_id && text(row.notachave)) {
      const recovered = dfeByKey.get(text(row.notachave));
      if (recovered) row.fiscal_dfe_documento_id = recovered.id;
    }
  }

  const dfeIds = Array.from(new Set(entryRows.map((row) => number(row.fiscal_dfe_documento_id)).filter(Boolean)));
  const noteIds = noteRows.map((row) => number(row.id)).filter(Boolean);
  const entryIds = entryRows.map((row) => number(row.id)).filter(Boolean);
  const [noteItems, entryItems, itemConfigs, creditDecisions, unitConversionRows, itemCorrelationRows] = await Promise.all([
    fetchAllByIds<Row, number>("itens das NF-e emitidas", noteIds, (ids, { from, to }) => supabaseAdmin
      .from("nfe_item").select("id, nfe_id, n_item, produtoid", { count: "exact" }).in("nfe_id", ids).order("id").range(from, to)).then(track),
    fetchAllByIds<Row, number>("itens das entradas", entryIds, (ids, { from, to }) => supabaseAdmin
      .from("entradaitens").select("id, entrada_id, numero_item_fiscal, produto_id", { count: "exact" }).in("entrada_id", ids)
      .not("numero_item_fiscal", "is", null).order("id").range(from, to)).then(track),
    fetchAllPages<Row>("configurações de item (0200)", ({ from, to }) => vigente(supabaseAdmin
      .from("fiscal_sped_item_config").select("*", { count: "exact" }).eq("empresa_id", companyId), start, end)
      .order("id").range(from, to)).then(track),
    fetchAllByIds<Row, number>("decisões de crédito", dfeIds, (ids, { from, to }) => vigente(supabaseAdmin
      .from("fiscal_sped_item_credito_decisao").select("*", { count: "exact" }).eq("empresa_id", companyId).in("documento_id", ids), start, end)
      .order("id").range(from, to)).then(track),
    fetchAllPages<Row>("conversões de unidade (0220)", ({ from, to }) => vigente(supabaseAdmin
      .from("fiscal_sped_unidade_conversao").select("*", { count: "exact" }).eq("empresa_id", companyId), start, end)
      .order("id").range(from, to)).then(track),
    fetchAllPages<Row>("correlações de item (0221)", ({ from, to }) => vigente(supabaseAdmin
      .from("fiscal_sped_item_correlacao").select("*", { count: "exact" }).eq("empresa_id", companyId), start, end)
      .order("id").range(from, to)).then(track),
  ]);

  const itemConfigById = new Map<number, Row>();
  const itemConfigsByProduct = new Map<number, Row[]>();
  const mappingDiagnostics: SpedDiagnostic[] = [];
  for (const row of foreignDfeRows) mappingDiagnostics.push({
    code: "DFE_ESTABELECIMENTO_DIVERGENTE",
    severity: "BLOQUEIO",
    message: `O DFe ${row.id} vinculado à entrada pertence a outro estabelecimento.`,
    source: { source: "BANCO", table: "fiscal_dfe_documento", id: row.id, documentKey: text(row.chave_acesso) },
  });
  for (const row of entryRows) {
    const dfe = dfeById.get(number(row.fiscal_dfe_documento_id)) ?? (text(row.notachave) ? dfeByKey.get(text(row.notachave)) : null);
    if (!dfe) {
      mappingDiagnostics.push({
        code: "DFE_ENTRADA_AUSENTE",
        severity: "BLOQUEIO",
        message: `A entrada ${row.id} (${text(row.notachave) || `SEM-CHAVE-${row.id}`}) é documental mas não possui documento DFe/XML no sistema.`,
        source: { source: "BANCO", table: "entrada", id: row.id, documentKey: text(row.notachave) || undefined },
      });
    }
  }
  for (const configRow of itemConfigs) {
    const configId = number(configRow.id);
    if (configId) itemConfigById.set(configId, configRow);
    const productId = number(configRow.produto_id);
    if (!productId) continue;
    itemConfigsByProduct.set(productId, [...(itemConfigsByProduct.get(productId) ?? []), configRow]);
  }

  const missingConfigIds = Array.from(new Set(
    itemCorrelationRows
      .flatMap((row) => [number(row.item_principal_id), number(row.item_atomico_id)])
      .filter((id) => id && !itemConfigById.has(id)),
  ));
  for (const configRow of track(await fetchAllByIds<Row, number>("configurações das correlações", missingConfigIds, (ids, { from, to }) => supabaseAdmin
    .from("fiscal_sped_item_config").select("*", { count: "exact" }).in("id", ids).order("id").range(from, to)))) {
    const configId = number(configRow.id);
    if (configId) itemConfigById.set(configId, configRow);
  }

  const unitConversions: SpedUnitConversion[] = unitConversionRows.map((row) => ({
    id: row.id,
    codigoItem: row.codigo_item ? text(row.codigo_item) : null,
    unidadeOrigem: text(row.unidade_origem),
    unidadeDestino: text(row.unidade_destino),
    fatorConversao: number(row.fator_conversao),
    vigenciaInicio: text(row.vigencia_inicio),
    vigenciaFim: row.vigencia_fim ? text(row.vigencia_fim) : null,
  }));

  const itemCorrelations: SpedItemCorrelation[] = itemCorrelationRows.map((row) => {
    const principal = itemConfigById.get(number(row.item_principal_id));
    const atomico = itemConfigById.get(number(row.item_atomico_id));
    return {
      id: row.id,
      codigoItemPrincipal: text(principal?.codigo_item),
      codigoItemAtomico: text(atomico?.codigo_item),
      quantidade: number(row.quantidade),
      vigenciaInicio: text(row.vigencia_inicio),
      vigenciaFim: row.vigencia_fim ? text(row.vigencia_fim) : null,
    };
  });

  const noteItemsByDocument = new Map<number, Row[]>();
  for (const item of [...noteItems].sort((left, right) => number(left.n_item) - number(right.n_item))) {
    const documentId = number(item.nfe_id);
    noteItemsByDocument.set(documentId, [...(noteItemsByDocument.get(documentId) ?? []), item]);
  }
  const entryItemsByDocument = new Map<number, Row[]>();
  for (const item of entryItems) {
    const documentId = number(item.entrada_id);
    entryItemsByDocument.set(documentId, [...(entryItemsByDocument.get(documentId) ?? []), item]);
  }
  const creditDecisionsByItem = new Map<string, Row[]>();
  for (const decision of creditDecisions) {
    const key = `${number(decision.documento_id)}:${number(decision.numero_item)}`;
    creditDecisionsByItem.set(key, [...(creditDecisionsByItem.get(key) ?? []), decision]);
  }

  // Cadastro dos produtos movimentados: é a fonte do 0200 e da resolução automática.
  const productIds = Array.from(new Set([
    ...noteItems.map((item) => number(item.produtoid)),
    ...entryItems.map((item) => number(item.produto_id)),
  ].filter(Boolean)));
  const productRows = track(await fetchAllByIds<Row, number>("produtos movimentados", productIds, (ids, { from, to }) => supabaseAdmin
    .from("produto").select("id, titulo, descricao, unidade, ncm, cest, codigobarras, aliquotaicms, precovenda, is_deleted", { count: "exact" })
    .in("id", ids).order("id").range(from, to)));
  const productsById = new Map<number, Row>(productRows.map((row) => [number(row.id), row]));

  const paymentImportIds = ((paymentImportsResult.data ?? []) as Row[]).map((row) => number(row.id)).filter(Boolean);
  const payments1601 = track(await fetchAllByIds<Row, number>("linhas do 1601", paymentImportIds, (ids, { from, to }) => supabaseAdmin
    .from("fiscal_sped_1601_linha").select("*", { count: "exact" }).in("importacao_id", ids).order("id").range(from, to)))
    .sort((left, right) => number(left.importacao_id) - number(right.importacao_id) || number(left.numero_linha) - number(right.numero_linha));
  const inventoryId = number(config?.inventario_fechamento_id);
  const inventoryResult = inventoryId
    ? await supabaseAdmin.from("fiscal_inventario_fechamento").select("*").eq("id", inventoryId).eq("empresa_id", companyId).eq("status", "APROVADO").maybeSingle()
    : { data: null, error: null };
  throwIfSupabaseError(inventoryResult.error);
  const inventoryItems = inventoryResult.data
    ? track(await fetchAllPages<Row>("itens do inventário", ({ from, to }) => supabaseAdmin
      .from("fiscal_inventario_item").select("*, config:fiscal_sped_item_config(tipo_item)", { count: "exact" })
      .eq("inventario_id", inventoryId).order("id").range(from, to)))
      .sort((left, right) => text(left.codigo_item).localeCompare(text(right.codigo_item), "en") || number(left.id) - number(right.id))
    : [];

  const timezone = text(config?.timezone_iana) || null;
  const unconfirmedEntryIds = rawUndated
    .filter((row) => isPendingFiscalDateCandidateForCompetence(row, { start, end }, timezone))
    .map((row) => number(row.id));
  // Emitida na competência, registrada depois e ainda sem data fiscal: não é
  // presumida na competência, mas o operador precisa saber que ela existe.
  const lateEntryWarnings: SpedDiagnostic[] = rawUndated
    .filter((row) => isSpedFiscalEntryCandidate(row) && !unconfirmedEntryIds.includes(number(row.id)))
    .filter((row) => month(row.dfe?.data_emissao ?? row.data_emissao) === competenceText)
    .map((row) => ({
      code: "ENTRADA_EMITIDA_NA_COMPETENCIA_SEM_DATA",
      severity: "AVISO" as const,
      message: `A entrada ${row.id} (${text(row.notachave) || "sem chave"}) foi emitida em ${competenceText}, registrada depois e ainda não tem data fiscal. Confirme a data de entrada se a mercadoria chegou nesta competência.`,
      source: { source: "BANCO" as const, table: "entrada", id: row.id, documentKey: text(row.notachave) || undefined },
    }));

  const receivedWithoutEntry = await receivedDocumentsWithoutEntry({ companyId, start, end, competenceText, timezone, track });

  return {
    competence: competenceText,
    start,
    end,
    companyId,
    company: companyResult.data as Row | null,
    config,
    accountant: accountantResult.data as Row | null,
    noteRows,
    unsettledNoteRows,
    entryRows: entryRows.map((row) => ({
      ...row,
      dfe: dfeById.get(number(row.fiscal_dfe_documento_id)) ?? (text(row.notachave) ? dfeByKey.get(text(row.notachave)) : null) ?? null,
    })) as Row[],
    noteItemsByDocument,
    entryItemsByDocument,
    itemConfigsByProduct,
    allItemConfigs: itemConfigs,
    creditDecisionsByItem,
    productsById,
    unitConversions,
    itemCorrelations,
    mappingDiagnostics: [...mappingDiagnostics, ...lateEntryWarnings, ...receivedWithoutEntry],
    unconfirmedEntryIds,
    priorEfd: priorEfdResult.data as Row | null,
    payments1601,
    adjustments: adjustments.map((row) => ({
      id: row.id,
      destination: row.registro_destino,
      nature: row.natureza,
      code: row.codigo_ajuste,
      uf: row.uf,
      value: number(row.valor),
      description: text(row.descricao),
      documentNumber: row.numero_documento,
      reference: row.referencia ?? {},
    })),
    inventory: inventoryResult.data as Row | null,
    inventoryItems,
    collection,
  };
}

export type SpedSourceContext = Awaited<ReturnType<typeof collectSpedSources>>;

/**
 * NF-e emitidas contra o CNPJ na competência (distribuição DF-e) sem entrada
 * no ERP. Não bloqueia: a mercadoria pode não ter chegado ou ter sido
 * recusada. Mas uma compra não pode sumir do SPED sem que alguém saiba.
 */
async function receivedDocumentsWithoutEntry(input: {
  companyId: number;
  start: string;
  end: string;
  competenceText: string;
  timezone: string | null;
  track: <T>(result: { rows: T[]; report: SpedCollectionReport }) => T[];
}): Promise<SpedDiagnostic[]> {
  const received = input.track(await fetchAllPages<Row>("NF-e recebidas na SEFAZ", ({ from, to }) => supabaseAdmin
    .from("fiscal_dfe_documento").select("id, chave_acesso, schema, status, data_emissao, emitente_nome", { count: "exact" })
    .eq("empresa_id", input.companyId)
    .gte("data_emissao", `${shiftCivilDate(input.start, -1)}T00:00:00`).lte("data_emissao", `${shiftCivilDate(input.end, 1)}T23:59:59.999`)
    .order("id").range(from, to)));
  const byKey = new Map<string, Row>();
  for (const row of received) {
    const key = text(row.chave_acesso);
    if (!/^d{44}$/.test(key) || !/^(procNFe|resNFe)/i.test(text(row.schema)) || /CANCEL|DENEG/i.test(text(row.status))) continue;
    const civil = civilDateInTimezone(row.data_emissao, input.timezone) ?? text(row.data_emissao).slice(0, 10);
    if (civil.slice(0, 7) !== input.competenceText) continue;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  if (byKey.size === 0) return [];
  const keys = Array.from(byKey.keys());
  const linked = input.track(await fetchAllByIds<Row, string>("entradas das NF-e recebidas", keys, (part, { from, to }) => supabaseAdmin
    .from("entrada").select("id, notachave", { count: "exact" }).in("notachave", part).order("id").range(from, to)));
  const linkedById = input.track(await fetchAllByIds<Row, number>("entradas vinculadas ao DF-e", received.map((row) => number(row.id)), (part, { from, to }) => supabaseAdmin
    .from("entrada").select("id, fiscal_dfe_documento_id", { count: "exact" }).in("fiscal_dfe_documento_id", part).order("id").range(from, to)));
  const entered = new Set(linked.map((row) => text(row.notachave)));
  const enteredDfe = new Set(linkedById.map((row) => number(row.fiscal_dfe_documento_id)));
  const keyByDfe = new Map(received.map((row) => [number(row.id), text(row.chave_acesso)]));
  for (const id of enteredDfe) {
    const key = keyByDfe.get(id);
    if (key) entered.add(key);
  }
  return keys.filter((key) => !entered.has(key)).map((key) => {
    const row = byKey.get(key)!;
    return {
      code: "NFE_RECEBIDA_SEM_ENTRADA",
      severity: "AVISO" as const,
      message: `A NF-e ${key}${text(row.emitente_nome) ? ` de ${text(row.emitente_nome)}` : ""} foi emitida contra a empresa em ${input.competenceText} e não tem entrada no ERP.`,
      source: { source: "BANCO" as const, table: "fiscal_dfe_documento", id: row.id, documentKey: key },
    };
  });
}

export function productMaster(row: Row | undefined | null): SpedProductMaster | null {
  if (!row) return null;
  const rate = row.aliquotaicms == null || row.aliquotaicms === "" ? null : Number(row.aliquotaicms);
  return {
    description: text(row.titulo) || text(row.descricao) || null,
    unit: text(row.unidade) || null,
    ncm: text(row.ncm) || null,
    cest: text(row.cest) || null,
    barcode: text(row.codigobarras) || null,
    internalIcmsRate: rate != null && Number.isFinite(rate) ? rate : null,
  };
}
