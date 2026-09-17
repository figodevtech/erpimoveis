import "server-only";

import {
  endOfCompetence,
  isCivilDateInCompetence,
  isValidCivilDate,
  isValidIanaTimezone,
  parseCompetence,
  parseFiscalDate,
} from "@/lib/fiscal-date";
import {
  hasBlockingDiagnostics,
  resolveSpedLayout,
  serializeEfd,
  validateSpedCandidate,
  type EfdRecord,
  type SpedDiagnostic,
  type SpedGateStatus,
  type SpedConditionalEvidence,
} from "@/lib/sped/efd-icms-ipi";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { toSpedContabilista } from "./accountantService";
import { SpedServiceError, throwIfSupabaseError } from "./errors";
import { singleCompanyId } from "./guards";
import { projectSpedAssessment, type SpedAssessmentProjection } from "./assessmentProjection";
import { hashStableJson, sha256Hex } from "./hash";
import { projectSpedInventory } from "./inventoryProjection";
import { buildFoundationRecords, buildGateConfiguration, validateFoundation } from "./projection";
import {
  projectFiscalDocument,
  type ProjectedFiscalDocument,
  type SpedItemAssignment,
} from "./documentProjection";
import type { SpedCompetenciaDetail, SpedCompetenciaSummary, SpedGateView } from "./types";

const ENGINE_VERSION = "0.1.0";
const PRACTICAL_GUIDE = "3.2.4";
const STORAGE_BUCKET = "fiscal-sped";
/** Valores de enum_status_nfe que o motor escritura a partir do XML. */
const SETTLED_NOTE_STATUSES = ["AUTORIZADA", "CANCELADA"] as const;
/** Existem na SEFAZ ou podem existir, mas o motor ainda não escritura: bloqueiam em vez de sumir do arquivo. */
const UNSETTLED_NOTE_STATUSES = ["DENEGADA", "ENVIADA", "CONTINGENCIA", "RESULTADO_INCERTO"] as const;

type Row = Record<string, any>;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function gateStatus(value: unknown): SpedGateStatus {
  const normalized = text(value);
  return normalized === "CONFIRMADO" || normalized === "NAO_APLICAVEL" ? normalized : "PENDENTE";
}

function gitCommit(): string {
  const value = text(process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA).toLowerCase();
  return /^[a-f0-9]{7,64}$/.test(value) ? value : "0000000";
}

function month(value: unknown): string {
  return text(value).slice(0, 7);
}

function assertId(value: string | number): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new SpedServiceError("Identificador SPED inválido.", 400, "INVALID_ID");
  return id;
}

function assertExpectedVersion(current: Row | null, expected: unknown) {
  const parsed = expected === null || expected === undefined ? null : Number(expected);
  const currentVersion = current ? number(current.numero) : null;
  if (parsed !== currentVersion) {
    throw new SpedServiceError("A competência foi alterada por outro processo. Atualize a página.", 409, "VERSION_CONFLICT");
  }
}

async function getCompetence(id: string | number): Promise<Row> {
  const result = await supabaseAdmin.from("fiscal_sped_competencia").select("*").eq("id", assertId(id)).maybeSingle();
  throwIfSupabaseError(result.error);
  if (!result.data) throw new SpedServiceError("Competência SPED não encontrada.", 404, "NOT_FOUND");
  return result.data;
}

async function getVersion(id: unknown): Promise<Row | null> {
  if (id == null) return null;
  const result = await supabaseAdmin.from("fiscal_sped_versao").select("*").eq("id", Number(id)).maybeSingle();
  throwIfSupabaseError(result.error);
  return result.data ?? null;
}

async function getConfig(companyId: number): Promise<Row | null> {
  const result = await supabaseAdmin.from("fiscal_sped_config").select("*").eq("empresa_id", companyId).maybeSingle();
  throwIfSupabaseError(result.error);
  return result.data ?? null;
}

function shiftCivilDate(value: string, days: number): string {
  const [year, monthValue, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthValue - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function fiscalEmissionCivilDate(row: Row): string | null {
  const xml = text(row.xml_autorizado || row.xml_assinado);
  const lexical = /<(?:\w+:)?(?:dhEmi|dEmi)>\s*([^<]+)\s*<\/(?:\w+:)?(?:dhEmi|dEmi)>/i.exec(xml)?.[1];
  return parseFiscalDate(lexical)?.civilDate ?? null;
}

async function sourceContext(competence: Row) {
  const competenceText = month(competence.competencia);
  const { start } = parseCompetence(competenceText);
  const end = endOfCompetence(competenceText);
  const noteQueryStart = shiftCivilDate(start, -2);
  const noteQueryEnd = shiftCivilDate(end, 2);
  const companyId = number(competence.empresa_id);
  const [companyResult, config, accountantResult, notesResult, entriesResult, undatedEntriesResult, priorEfdResult, paymentImportsResult, adjustmentsResult] = await Promise.all([
    supabaseAdmin.from("empresa").select("id, cnpj, razaosocial, nomefantasia, inscricaoestadual, inscricaomunicipal, endereco, codigomunicipio, bairro, numero, complemento, cep, uf, telefone, email").eq("id", companyId).maybeSingle(),
    getConfig(companyId),
    supabaseAdmin.from("fiscal_sped_contabilista").select("*").eq("empresa_id", companyId).lte("vigencia_inicio", end).or(`vigencia_fim.is.null,vigencia_fim.gte.${start}`).order("vigencia_inicio", { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("nfe").select("id, chave_acesso, status, modelo, dataemissao, xml_autorizado, xml_assinado", { count: "exact" }).eq("empresaid", companyId).eq("is_deleted", false).eq("ambiente", "PRODUCAO").gte("dataemissao", `${noteQueryStart}T00:00:00`).lte("dataemissao", `${noteQueryEnd}T23:59:59.999`).in("status", [...SETTLED_NOTE_STATUSES, ...UNSETTLED_NOTE_STATUSES]),
    supabaseAdmin.from("entrada").select("id, status, data_entrada_fiscal, fiscal_dfe_documento_id, notachave", { count: "exact" }).eq("fiscal", true).eq("status", "CONFIRMADA").gte("data_entrada_fiscal", start).lte("data_entrada_fiscal", end),
    supabaseAdmin.from("entrada").select("id").eq("fiscal", true).eq("status", "CONFIRMADA").is("data_entrada_fiscal", null).limit(1000),
    supabaseAdmin.from("fiscal_sped_efd_anterior_importacao").select("id, competencia_arquivo, arquivo_sha256, status, cabecalho, saldos_apuracao").eq("competencia_id", competence.id).eq("status", "VALIDADA").order("imported_at", { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("fiscal_sped_1601_importacao").select("id, arquivo_sha256, imported_at").eq("competencia_id", competence.id).eq("status", "VALIDADA").order("imported_at", { ascending: false }),
    supabaseAdmin.from("fiscal_sped_ajuste_apuracao").select("*").eq("competencia_id", competence.id).eq("ativo", true).order("id"),
  ]);
  throwIfSupabaseError(companyResult.error);
  throwIfSupabaseError(accountantResult.error);
  throwIfSupabaseError(notesResult.error);
  throwIfSupabaseError(entriesResult.error);
  throwIfSupabaseError(undatedEntriesResult.error);
  throwIfSupabaseError(priorEfdResult.error);
  throwIfSupabaseError(paymentImportsResult.error);
  throwIfSupabaseError(adjustmentsResult.error);
  const periodNoteRows = ((notesResult.data ?? []) as Row[]).filter((row) => {
    const civilDate = fiscalEmissionCivilDate(row);
    if (civilDate) return isCivilDateInCompetence(civilDate, competenceText);
    return month(row.dataemissao) === competenceText;
  });
  const isSettled = (row: Row) => (SETTLED_NOTE_STATUSES as readonly string[]).includes(text(row.status));
  const noteRows = periodNoteRows.filter(isSettled);
  const unsettledNoteRows = periodNoteRows.filter((row) => !isSettled(row));
  const entryRows = (entriesResult.data ?? []) as Row[];
  const dfeIds = Array.from(new Set(entryRows.map((row) => number(row.fiscal_dfe_documento_id)).filter(Boolean)));
  const dfeResult = dfeIds.length
    ? await supabaseAdmin.from("fiscal_dfe_documento").select("id, empresa_id, chave_acesso, schema, xml, status, data_emissao").in("id", dfeIds)
    : { data: [], error: null };
  throwIfSupabaseError(dfeResult.error);
  const dfeRows = (dfeResult.data ?? []) as Row[];
  const foreignDfeRows = dfeRows.filter((row) => number(row.empresa_id) !== companyId);
  const dfeById = new Map(dfeRows
    .filter((row) => number(row.empresa_id) === companyId)
    .map((row) => [number(row.id), row]));
  const noteIds = noteRows.map((row) => number(row.id)).filter(Boolean);
  const entryIds = entryRows.map((row) => number(row.id)).filter(Boolean);
  const [noteItemsResult, entryItemsResult, itemConfigsResult, creditDecisionsResult] = await Promise.all([
    noteIds.length
      ? supabaseAdmin.from("nfe_item").select("nfe_id, n_item, produtoid").in("nfe_id", noteIds).order("n_item")
      : Promise.resolve({ data: [], error: null }),
    entryIds.length
      ? supabaseAdmin.from("entradaitens").select("entrada_id, numero_item_fiscal, produto_id").in("entrada_id", entryIds).not("numero_item_fiscal", "is", null).order("id")
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin.from("fiscal_sped_item_config").select("*").eq("empresa_id", companyId).lte("vigencia_inicio", end).or(`vigencia_fim.is.null,vigencia_fim.gte.${start}`).order("vigencia_inicio", { ascending: false }),
    dfeIds.length
      ? supabaseAdmin.from("fiscal_sped_item_credito_decisao").select("*").eq("empresa_id", companyId).in("documento_id", dfeIds).lte("vigencia_inicio", end).or(`vigencia_fim.is.null,vigencia_fim.gte.${start}`).order("vigencia_inicio", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  throwIfSupabaseError(noteItemsResult.error);
  throwIfSupabaseError(entryItemsResult.error);
  throwIfSupabaseError(itemConfigsResult.error);
  throwIfSupabaseError(creditDecisionsResult.error);

  const itemConfigsByProduct = new Map<number, Row[]>();
  const mappingDiagnostics: SpedDiagnostic[] = [];
  for (const row of foreignDfeRows) mappingDiagnostics.push({
    code: "DFE_ESTABELECIMENTO_DIVERGENTE",
    severity: "BLOQUEIO",
    message: `O DFe ${row.id} vinculado à entrada pertence a outro estabelecimento.`,
    source: { source: "BANCO", table: "fiscal_dfe_documento", id: row.id, documentKey: text(row.chave_acesso) },
  });
  for (const configRow of (itemConfigsResult.data ?? []) as Row[]) {
    const productId = number(configRow.produto_id);
    if (!productId) continue;
    itemConfigsByProduct.set(productId, [...(itemConfigsByProduct.get(productId) ?? []), configRow]);
  }

  const noteItemsByDocument = new Map<number, Row[]>();
  for (const item of (noteItemsResult.data ?? []) as Row[]) {
    const documentId = number(item.nfe_id);
    noteItemsByDocument.set(documentId, [...(noteItemsByDocument.get(documentId) ?? []), item]);
  }
  const entryItemsByDocument = new Map<number, Row[]>();
  for (const item of (entryItemsResult.data ?? []) as Row[]) {
    const documentId = number(item.entrada_id);
    entryItemsByDocument.set(documentId, [...(entryItemsByDocument.get(documentId) ?? []), item]);
  }
  const creditDecisionsByItem = new Map<string, Row[]>();
  for (const decision of (creditDecisionsResult.data ?? []) as Row[]) {
    const key = `${number(decision.documento_id)}:${number(decision.numero_item)}`;
    creditDecisionsByItem.set(key, [...(creditDecisionsByItem.get(key) ?? []), decision]);
  }
  const paymentImportIds = ((paymentImportsResult.data ?? []) as Row[]).map((row) => number(row.id)).filter(Boolean);
  const paymentLinesResult = paymentImportIds.length
    ? await supabaseAdmin.from("fiscal_sped_1601_linha").select("*").in("importacao_id", paymentImportIds).order("importacao_id").order("numero_linha")
    : { data: [], error: null };
  throwIfSupabaseError(paymentLinesResult.error);
  const inventoryId = number(config?.inventario_fechamento_id);
  const inventoryResult = inventoryId
    ? await supabaseAdmin.from("fiscal_inventario_fechamento").select("*").eq("id", inventoryId).eq("empresa_id", companyId).eq("status", "APROVADO").maybeSingle()
    : { data: null, error: null };
  throwIfSupabaseError(inventoryResult.error);
  const inventoryItemsResult = inventoryResult.data
    ? await supabaseAdmin.from("fiscal_inventario_item").select("*, config:fiscal_sped_item_config(tipo_item)").eq("inventario_id", inventoryId).order("codigo_item").order("id")
    : { data: [], error: null };
  throwIfSupabaseError(inventoryItemsResult.error);

  return {
    competence: competenceText,
    start,
    end,
    company: companyResult.data as Row | null,
    config,
    accountant: accountantResult.data as Row | null,
    noteRows,
    unsettledNoteRows,
    entryRows: entryRows.map((row) => ({
      ...row,
      dfe: dfeById.get(number(row.fiscal_dfe_documento_id)) ?? null,
    })) as Row[],
    noteItemsByDocument,
    entryItemsByDocument,
    itemConfigsByProduct,
    creditDecisionsByItem,
    mappingDiagnostics,
    unconfirmedEntryIds: (undatedEntriesResult.data ?? []).map((row: Row) => number(row.id)),
    priorEfd: priorEfdResult.data as Row | null,
    payments1601: (paymentLinesResult.data ?? []) as Row[],
    adjustments: ((adjustmentsResult.data ?? []) as Row[]).map((row) => ({
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
    inventoryItems: (inventoryItemsResult.data ?? []) as Row[],
  };
}

function documentXml(row: Row): string {
  return text(row.xml_autorizado || row.xml_assinado || row.dfe?.xml);
}

function documentKey(row: Row): string {
  return text(row.chave_acesso || row.notachave || row.dfe?.chave_acesso) || `SEM-CHAVE-${row.id}`;
}

function hasPositiveXmlValue(xml: string, tags: readonly string[]): boolean {
  return tags.some((tag) => Array.from(xml.matchAll(new RegExp(`<${tag}>\\s*([^<]+)\\s*</${tag}>`, "gi")))
    .some((match) => {
      const value = Number(String(match[1]).trim().replace(",", "."));
      return Number.isFinite(value) && value > 0;
    }));
}

/** Detector deliberadamente amplo: um falso positivo gera revisao, nunca omissao fiscal. */
function conditionalEvidence(context: Awaited<ReturnType<typeof sourceContext>>): SpedConditionalEvidence {
  const keys = [...context.noteRows, ...context.entryRows]
    .filter((row) => {
      const xml = documentXml(row);
      if (!xml) return false;
      return /<CST>\s*60\s*<\/CST>/i.test(xml)
        || /<CSOSN>\s*500\s*<\/CSOSN>/i.test(xml)
        || hasPositiveXmlValue(xml, ["vICMSST", "vICMSSTRet", "vBCSTRet"])
        || /<finNFe>\s*4\s*<\/finNFe>/i.test(xml)
        || /<CFOP>\s*[26]\d{3}\s*<\/CFOP>/i.test(xml);
    })
    .map(documentKey);

  return {
    hasC176C179Evidence: keys.length > 0,
    c176C179DocumentKeys: Array.from(new Set(keys)).sort(),
  };
}

function effectiveRows(rows: Row[] | undefined, civilDate: string): Row[] {
  return (rows ?? []).filter((row) => {
    const start = text(row.vigencia_inicio).slice(0, 10);
    const end = text(row.vigencia_fim).slice(0, 10);
    return start <= civilDate && (!end || end >= civilDate);
  });
}

function assignmentFromProduct(
  context: Awaited<ReturnType<typeof sourceContext>>,
  productId: number,
  civilDate: string,
): { assignment: SpedItemAssignment | null; diagnostics: SpedDiagnostic[] } {
  const configs = effectiveRows(context.itemConfigsByProduct.get(productId), civilDate);
  if (configs.length > 1) return {
    assignment: null,
    diagnostics: [{
      code: "CONFIG_ITEM_VIGENCIA_SOBREPOSTA",
      severity: "BLOQUEIO",
      message: `O produto ${productId} possui configurações SPED sobrepostas em ${civilDate}.`,
      source: { source: "CONFIGURACAO", table: "fiscal_sped_item_config", id: configs[0].id },
    }],
  };
  const config = configs[0];
  if (!config) return { assignment: null, diagnostics: [] };
  return {
    assignment: {
      code: text(config.codigo_item),
      productId,
      itemConfigId: number(config.id),
      itemType: text(config.tipo_item) || null,
    },
    diagnostics: [],
  };
}

function documentAssignments(
  context: Awaited<ReturnType<typeof sourceContext>>,
  row: Row,
  operation: "ENTRADA" | "SAIDA",
  civilDate: string,
): { assignments: Map<number, SpedItemAssignment>; diagnostics: SpedDiagnostic[] } {
  const assignments = new Map<number, SpedItemAssignment>();
  const diagnostics: SpedDiagnostic[] = [];
  if (operation === "SAIDA") {
    for (const item of context.noteItemsByDocument.get(number(row.id)) ?? []) {
      const itemNumber = number(item.n_item);
      const productId = number(item.produtoid);
      if (!itemNumber || !productId) continue;
      const resolved = assignmentFromProduct(context, productId, civilDate);
      diagnostics.push(...resolved.diagnostics);
      if (resolved.assignment) assignments.set(itemNumber, resolved.assignment);
    }
    return { assignments, diagnostics };
  }

  const grouped = new Map<number, Set<number>>();
  for (const item of context.entryItemsByDocument.get(number(row.id)) ?? []) {
    const itemNumber = number(item.numero_item_fiscal);
    const productId = number(item.produto_id);
    if (!itemNumber || !productId) continue;
    const products = grouped.get(itemNumber) ?? new Set<number>();
    products.add(productId);
    grouped.set(itemNumber, products);
  }
  for (const [itemNumber, productIds] of grouped) {
    if (productIds.size > 1) {
      diagnostics.push({
        code: "APROPRIACAO_ITEM_AMBIGUA",
        severity: "BLOQUEIO",
        message: `O item fiscal ${itemNumber} da entrada ${row.id} foi apropriado para produtos diferentes.`,
        source: { source: "BANCO", table: "entradaitens", id: row.id, documentKey: documentKey(row) },
      });
      continue;
    }
    const productId = Array.from(productIds)[0];
    const resolved = assignmentFromProduct(context, productId, civilDate);
    diagnostics.push(...resolved.diagnostics);
    if (resolved.assignment) assignments.set(itemNumber, resolved.assignment);
  }

  const dfeId = number(row.fiscal_dfe_documento_id);
  for (const [itemNumber, assignment] of assignments) {
    const decisions = effectiveRows(context.creditDecisionsByItem.get(`${dfeId}:${itemNumber}`), civilDate);
    if (decisions.length > 1) {
      diagnostics.push({
        code: "DECISAO_CREDITO_VIGENCIA_SOBREPOSTA",
        severity: "BLOQUEIO",
        message: `O item ${itemNumber} do DFe ${dfeId} possui decisões de crédito sobrepostas em ${civilDate}.`,
        source: { source: "CONFIGURACAO", table: "fiscal_sped_item_credito_decisao", id: decisions[0].id },
      });
      continue;
    }
    if (decisions[0]) assignment.creditTreatment = text(decisions[0].tratamento_credito);
  }
  return { assignments, diagnostics };
}

function catalogIdentity(record: EfdRecord): string | null {
  if (record.code === "0150") return `${record.code}|${text(record.values.COD_PART)}`;
  if (record.code === "0190") return `${record.code}|${text(record.values.UNID)}`;
  if (record.code === "0200") return `${record.code}|${text(record.values.COD_ITEM)}`;
  return null;
}

function projectDocuments(context: Awaited<ReturnType<typeof sourceContext>>) {
  const documents: ProjectedFiscalDocument[] = [];
  const diagnostics: SpedDiagnostic[] = [...context.mappingDiagnostics];
  for (const row of context.noteRows) {
    const xml = documentXml(row);
    if (!xml) continue;
    const civilDate = fiscalEmissionCivilDate(row) ?? context.start;
    const mapped = documentAssignments(context, row, "SAIDA", civilDate);
    diagnostics.push(...mapped.diagnostics);
    try {
      documents.push(projectFiscalDocument({
        sourceType: ["65", "NFCE"].includes(text(row.modelo).toUpperCase()) ? "NFC_E" : "NFE_EMITIDA",
        sourceTable: "nfe",
        sourceId: row.id,
        operation: "SAIDA",
        status: text(row.status),
        xml,
        xmlSha256: sha256Hex(xml),
        itemAssignments: mapped.assignments,
      }));
    } catch (error) {
      diagnostics.push({
        code: "XML_FISCAL_INVALIDO",
        severity: "BLOQUEIO",
        message: `Não foi possível projetar o documento ${documentKey(row)}: ${error instanceof Error ? error.message : "erro desconhecido"}`,
        source: { source: "XML", table: "nfe", id: row.id, documentKey: documentKey(row) },
      });
    }
  }
  for (const row of context.entryRows) {
    const xml = documentXml(row);
    if (!xml) continue;
    const civilDate = text(row.data_entrada_fiscal).slice(0, 10);
    const mapped = documentAssignments(context, row, "ENTRADA", civilDate);
    diagnostics.push(...mapped.diagnostics);
    try {
      documents.push(projectFiscalDocument({
        sourceType: "NFE_RECEBIDA",
        sourceTable: "entrada",
        sourceId: row.id,
        operation: "ENTRADA",
        status: text(row.dfe?.status || row.status),
        xml,
        xmlSha256: sha256Hex(xml),
        receivedDocumentId: number(row.fiscal_dfe_documento_id) || null,
        bookkeepingDate: civilDate,
        itemAssignments: mapped.assignments,
      }));
    } catch (error) {
      diagnostics.push({
        code: "XML_FISCAL_INVALIDO",
        severity: "BLOQUEIO",
        message: `Não foi possível projetar a entrada ${row.id}: ${error instanceof Error ? error.message : "erro desconhecido"}`,
        source: { source: "XML", table: "entrada", id: row.id, documentKey: documentKey(row) },
      });
    }
  }

  documents.sort((left, right) => {
    const leftDate = left.bookkeepingDate || left.emissionDate.civilDate;
    const rightDate = right.bookkeepingDate || right.emissionDate.civilDate;
    return leftDate.localeCompare(rightDate, "en") || left.key.localeCompare(right.key, "en");
  });
  const uniqueDocuments: ProjectedFiscalDocument[] = [];
  const seenKeys = new Set<string>();
  for (const document of documents) {
    if (seenKeys.has(document.key)) {
      diagnostics.push({
        code: "DOCUMENTO_FISCAL_DUPLICADO",
        severity: "BLOQUEIO",
        message: `A chave ${document.key} aparece mais de uma vez nas fontes da competência.`,
        source: { source: "BANCO", table: document.sourceTable, id: document.sourceId, documentKey: document.key },
      });
      continue;
    }
    seenKeys.add(document.key);
    uniqueDocuments.push(document);
  }
  const catalogs = new Map<string, EfdRecord>();
  const blockCRecords: EfdRecord[] = [];
  for (const document of uniqueDocuments) {
    diagnostics.push(...document.diagnostics);
    blockCRecords.push(...document.blockCRecords);
    for (const record of document.catalogRecords) {
      const identity = catalogIdentity(record);
      if (!identity) continue;
      const previous = catalogs.get(identity);
      if (previous && hashStableJson(previous.values) !== hashStableJson(record.values)) {
        diagnostics.push({
          code: "CADASTRO_FISCAL_DIVERGENTE",
          severity: "BLOQUEIO",
          message: `${identity} possui dados históricos divergentes entre os XMLs da competência.`,
          record: record.code,
          source: record.source,
        });
        continue;
      }
      if (!previous) catalogs.set(identity, record);
    }
  }
  return {
    documents: uniqueDocuments,
    catalogRecords: Array.from(catalogs.values()),
    blockCRecords,
    diagnostics,
  };
}

async function readStoredRecords(versionId: number): Promise<EfdRecord[]> {
  const result = await supabaseAdmin
    .from("fiscal_sped_cadastro_snapshot")
    .select("payload")
    .eq("versao_id", versionId)
    .eq("tipo", "CONFIG")
    .eq("codigo", "EFD_RECORDS")
    .maybeSingle();
  throwIfSupabaseError(result.error);
  const records = (result.data?.payload as Row | undefined)?.records;
  return Array.isArray(records) ? (records as EfdRecord[]) : [];
}

function sourceDiagnostics(
  context: Awaited<ReturnType<typeof sourceContext>>,
  projectionDiagnostics: SpedDiagnostic[],
): SpedDiagnostic[] {
  const diagnostics = [...validateFoundation(context), ...projectionDiagnostics];
  if (!context.priorEfd) diagnostics.push({
    code: "EFD_ANTERIOR_AUSENTE",
    severity: "BLOQUEIO",
    message: "A EFD anterior validada é obrigatória para saldos iniciais e reconciliação da apuração.",
    source: { source: "IMPORTACAO", table: "fiscal_sped_efd_anterior_importacao" },
  });
  for (const row of context.unsettledNoteRows) diagnostics.push({
    code: "NFE_SITUACAO_NAO_ESCRITURAVEL",
    severity: "BLOQUEIO",
    message: text(row.status) === "DENEGADA"
      ? `A NF-e ${documentKey(row)} foi denegada e exige C100 com COD_SIT 04, que o motor ainda não gera.`
      : `A NF-e ${documentKey(row)} está com situação ${text(row.status)} e precisa ser resolvida na SEFAZ antes do fechamento.`,
    source: { source: "BANCO", table: "nfe", id: row.id, documentKey: documentKey(row) },
  });
  for (const row of [...context.noteRows, ...context.entryRows]) {
    if (!documentXml(row)) diagnostics.push({
      code: "XML_FISCAL_AUSENTE",
      severity: "BLOQUEIO",
      message: `O documento ${documentKey(row)} não possui XML completo preservado.`,
      source: {
        source: "BANCO",
        table: row.dfe !== undefined ? "entrada" : "nfe",
        id: row.id,
        documentKey: documentKey(row),
      },
    });
  }
  return diagnostics;
}

function contextHash(
  context: Awaited<ReturnType<typeof sourceContext>>,
  records: EfdRecord[],
  documents: ProjectedFiscalDocument[],
): string {
  return hashStableJson({
    competence: context.competence,
    company: context.company,
    config: context.config,
    accountant: context.accountant,
    notes: context.noteRows.map((row) => ({ id: row.id, key: row.chave_acesso, status: row.status, xmlHash: documentXml(row) ? sha256Hex(documentXml(row)) : null })),
    unsettledNotes: context.unsettledNoteRows.map((row) => ({ id: row.id, status: row.status })),
    entries: context.entryRows.map((row) => ({ id: row.id, date: row.data_entrada_fiscal, status: row.status, key: documentKey(row), xmlHash: documentXml(row) ? sha256Hex(documentXml(row)) : null })),
    unconfirmedEntryIds: context.unconfirmedEntryIds,
    priorEfd: context.priorEfd,
    payments1601: context.payments1601,
    adjustments: context.adjustments,
    inventory: context.inventory,
    inventoryItems: context.inventoryItems,
    projectedDocuments: documents.map((document) => ({
      sourceType: document.sourceType,
      sourceId: document.sourceId,
      key: document.key,
      xmlSha256: document.xmlSha256,
      operation: document.operation,
      situationCode: document.situationCode,
      emissionDate: document.emissionDate,
      bookkeepingDate: document.bookkeepingDate,
      participant: document.participantDocumentCanonical,
      payload: document.payload,
      items: document.items,
    })),
    records,
    engine: ENGINE_VERSION,
  });
}

async function openVersion(competence: Row, actorId: string, hash: string): Promise<Row> {
  const result = await supabaseAdmin.rpc("fiscal_sped_abrir_versao", {
    p_competencia_id: number(competence.id),
    p_finalidade: "ORIGINAL",
    p_leiaute: "020",
    p_guia_pratico: PRACTICAL_GUIDE,
    p_motor_versao: ENGINE_VERSION,
    p_git_commit: gitCommit(),
    p_source_cutoff_at: new Date().toISOString(),
    p_context_hash: hash,
    p_usuario_id: actorId,
  });
  throwIfSupabaseError(result.error);
  const version = await getVersion(result.data);
  if (!version) throw new SpedServiceError("Versão SPED não foi criada.", 500);
  return version;
}

async function storeRecords(version: Row, records: EfdRecord[]) {
  if (version.status !== "RASCUNHO") return;
  const payload = { records };
  const payloadHash = hashStableJson(payload);
  const existing = await supabaseAdmin.from("fiscal_sped_cadastro_snapshot").select("id, payload_sha256").eq("versao_id", version.id).eq("tipo", "CONFIG").eq("codigo", "EFD_RECORDS").maybeSingle();
  throwIfSupabaseError(existing.error);
  if (existing.data?.payload_sha256 === payloadHash) return;
  if (existing.data) {
    const removed = await supabaseAdmin.from("fiscal_sped_cadastro_snapshot").delete().eq("id", existing.data.id);
    throwIfSupabaseError(removed.error);
  }
  const inserted = await supabaseAdmin.from("fiscal_sped_cadastro_snapshot").insert({
    versao_id: version.id,
    tipo: "CONFIG",
    codigo: "EFD_RECORDS",
    documento_tipo: "SEM_DOCUMENTO",
    documento_canonico: null,
    documento_original: null,
    payload,
    source_refs: [{ source: "CALCULO", engine: ENGINE_VERSION }],
    payload_sha256: payloadHash,
  });
  throwIfSupabaseError(inserted.error);
}

function catalogSnapshotRows(
  records: EfdRecord[],
  documents: ProjectedFiscalDocument[],
): Row[] {
  const documentCounts = new Map<string, number>();
  for (const document of documents) {
    const identities = new Set(document.catalogRecords.map(catalogIdentity).filter(Boolean) as string[]);
    for (const identity of identities) {
      documentCounts.set(identity, (documentCounts.get(identity) ?? 0) + 1);
    }
  }

  return records.flatMap((record) => {
    const identity = catalogIdentity(record);
    if (!identity) return [];
    let type: "PARTICIPANTE" | "ITEM" | "UNIDADE";
    let code: string;
    let documentType: "CNPJ" | "CPF" | "ID_EXTERIOR" | "SEM_DOCUMENTO" = "SEM_DOCUMENTO";
    let documentCanonical: string | null = null;
    let documentOriginal: string | null = null;
    let payload: Row;
    if (record.code === "0150") {
      type = "PARTICIPANTE";
      code = text(record.values.COD_PART);
      const projected = documents.find((document) => document.participantCode === code);
      if (record.values.CNPJ) {
        documentType = "CNPJ";
        documentCanonical = text(record.values.CNPJ);
      } else if (record.values.CPF) {
        documentType = "CPF";
        documentCanonical = text(record.values.CPF);
      } else if (projected?.participantDocumentType === "ID_EXTERIOR") {
        documentType = "ID_EXTERIOR";
        documentCanonical = projected.participantDocumentCanonical;
      }
      documentOriginal = projected?.participantDocumentOriginal ?? documentCanonical;
      payload = {
        nome: text(record.values.NOME),
        inscricaoEstadual: text(record.values.IE) || null,
        municipio: text(record.values.COD_MUN) || null,
        pais: text(record.values.COD_PAIS) || null,
        documentosReferenciados: documentCounts.get(identity) ?? 0,
        registro: record.values,
      };
    } else if (record.code === "0200") {
      type = "ITEM";
      code = text(record.values.COD_ITEM);
      payload = {
        descricao: text(record.values.DESCR_ITEM),
        tipoItem: text(record.values.TIPO_ITEM) || null,
        ncm: text(record.values.COD_NCM) || null,
        cest: text(record.values.CEST) || null,
        unidade: text(record.values.UNID_INV) || null,
        documentosReferenciados: documentCounts.get(identity) ?? 0,
        possui0220: false,
        possui0221: false,
        registro: record.values,
      };
    } else {
      type = "UNIDADE";
      code = text(record.values.UNID);
      payload = {
        descricao: text(record.values.DESCR),
        documentosReferenciados: documentCounts.get(identity) ?? 0,
        registro: record.values,
      };
    }
    return [{
      tipo: type,
      codigo: code,
      documento_tipo: documentType,
      documento_canonico: documentCanonical,
      documento_original: documentOriginal,
      payload,
      source_refs: record.source ? [record.source] : [],
      payload_sha256: hashStableJson(payload),
    }];
  });
}

async function storeDocumentSnapshots(
  version: Row,
  documents: ProjectedFiscalDocument[],
  records: EfdRecord[],
  assessment: SpedAssessmentProjection,
) {
  if (version.status !== "RASCUNHO") return;
  const documentPayload = documents.map((document) => ({
    fonte_tipo: document.sourceType,
    fonte_tabela: document.sourceTable,
    fonte_id: document.sourceId,
    operacao: document.operation,
    chave_acesso: document.key,
    modelo: document.model,
    codigo_situacao: document.situationCode,
    data_emissao_civil: document.emissionDate.civilDate,
    data_emissao_original: document.emissionDate.originalText ?? null,
    data_emissao_offset: document.emissionDate.originalOffset ?? null,
    data_emissao_instante_utc: document.emissionDate.instantUtc ?? null,
    data_escrituracao_civil: document.bookkeepingDate,
    participante_codigo: document.participantCode,
    participante_documento_tipo: document.participantDocumentType,
    participante_documento_canonico: document.participantDocumentCanonical,
    participante_documento_original: document.participantDocumentOriginal,
    xml_sha256: document.xmlSha256,
    payload: document.payload,
    source_refs: [{
      source: "XML",
      table: document.sourceTable,
      id: document.sourceId,
      documentKey: document.key,
    }],
    itens: document.items.map((item) => ({
      numero_item: item.number,
      produto_id: item.productId,
      item_config_id: item.itemConfigId,
      codigo_item: item.code,
      unidade_documento: item.documentUnit,
      unidade_inventario: item.inventoryUnit,
      tratamento_credito: item.creditTreatment,
      payload: item.payload,
      source_refs: item.sourceRefs,
    })),
  }));
  const result = await supabaseAdmin.rpc("fiscal_sped_substituir_snapshots_documentais", {
    p_versao_id: number(version.id),
    p_documentos: documentPayload,
    p_cadastros: catalogSnapshotRows(records, documents),
    p_apuracoes: assessment.snapshots.map((snapshot) => ({
      tipo: snapshot.type,
      uf: snapshot.uf,
      periodo_inicio: snapshot.periodStart,
      periodo_fim: snapshot.periodEnd,
      payload: snapshot.payload,
      payload_sha256: hashStableJson(snapshot.payload),
    })),
  });
  throwIfSupabaseError(result.error);
}

async function replaceDiagnostics(executionId: number, diagnostics: SpedDiagnostic[]) {
  if (diagnostics.length === 0) return;
  const result = await supabaseAdmin.from("fiscal_sped_inconsistencia").insert(diagnostics.map((diagnostic) => ({
    execucao_id: executionId,
    severidade: diagnostic.severity,
    codigo: diagnostic.code,
    registro_efd: diagnostic.record ?? null,
    campo_efd: diagnostic.field ?? null,
    tabela_origem: diagnostic.source?.table ?? null,
    registro_origem_id: diagnostic.source?.id == null ? null : String(diagnostic.source.id),
    referencia_origem: { source: diagnostic.source ?? null, context: diagnostic.context ?? null },
    mensagem: diagnostic.message,
  })));
  throwIfSupabaseError(result.error);
}

async function resolveCompanyId(companyId: number | null | undefined): Promise<number> {
  if (companyId != null) return companyId;
  const result = await supabaseAdmin.from("empresa").select("id").order("id").limit(2);
  throwIfSupabaseError(result.error);
  const chosen = singleCompanyId(((result.data ?? []) as Row[]).map((row) => number(row.id)));
  if ("id" in chosen) return chosen.id;
  throw chosen.error === "NENHUMA"
    ? new SpedServiceError("Cadastre a empresa antes de abrir uma competência SPED.", 422, "COMPANY_REQUIRED")
    : new SpedServiceError("Há mais de uma empresa cadastrada: informe a empresa da competência.", 400, "COMPANY_AMBIGUOUS");
}

export async function createSpedCompetence(input: { companyId?: number | null; competence: string; actorId: string }) {
  let start: string;
  try {
    start = parseCompetence(input.competence).start;
  } catch (error) {
    throw new SpedServiceError(error instanceof Error ? error.message : "Competência inválida.", 400, "INVALID_COMPETENCE");
  }
  const companyId = await resolveCompanyId(input.companyId);
  const result = await supabaseAdmin.rpc("fiscal_sped_criar_competencia", {
    p_empresa_id: companyId,
    p_competencia: start,
    p_usuario_id: input.actorId,
  });
  throwIfSupabaseError(result.error);
  return getSpedCompetenceDetail(String(result.data));
}

export async function validateSpedCompetence(id: string, expectedVersion: unknown, actorId: string) {
  let competence = await getCompetence(id);
  let version = await getVersion(competence.versao_atual_id);
  assertExpectedVersion(version, expectedVersion);
  if (version && !["RASCUNHO", "VALIDADA"].includes(text(version.status))) {
    throw new SpedServiceError("A competência está fechada. Reabra para validar novamente.", 409, "COMPETENCE_CLOSED");
  }
  const context = await sourceContext(competence);
  const projection = projectDocuments(context);
  const inventory = projectSpedInventory({
    applicable: context.config?.inventario_aplicavel === true,
    inventory: context.inventory,
    items: context.inventoryItems,
    competenceEnd: context.end,
  });
  const assessment = projectSpedAssessment({
    competence: context.competence,
    documents: projection.documents,
    priorEfd: context.priorEfd,
    adjustments: context.adjustments,
  });
  const records = context.company ? buildFoundationRecords({
    competence: context.competence,
    company: context.company,
    config: context.config,
    accountant: context.accountant,
    payments1601: context.payments1601,
    catalogRecords: [...projection.catalogRecords, ...inventory.catalogRecords],
    blockCRecords: projection.blockCRecords,
    blockERecords: assessment.blockERecords,
    blockHRecords: inventory.records,
  }) : [];
  const hash = contextHash(context, records, projection.documents);
  if (!version) version = await openVersion(competence, actorId, hash);
  if (version.status === "VALIDADA" && version.context_hash !== hash) {
    // Uma decisão de item ou importação mudou as fontes depois da validação. Reabrir
    // só vale para competência fechada; a versão ainda editável volta a rascunho.
    const reverted = await supabaseAdmin
      .from("fiscal_sped_versao")
      .update({ status: "RASCUNHO", validated_at: null, validated_by: null })
      .eq("id", version.id)
      .eq("status", "VALIDADA")
      .select("*")
      .maybeSingle();
    throwIfSupabaseError(reverted.error);
    if (!reverted.data) throw new SpedServiceError("A competência foi alterada por outro processo. Atualize a página.", 409, "VERSION_CONFLICT");
    version = reverted.data as Row;
  }
  if (version.status === "RASCUNHO") {
    await storeDocumentSnapshots(version, projection.documents, records, assessment);
    await storeRecords(version, records);
    const updated = await supabaseAdmin.from("fiscal_sped_versao").update({ context_hash: hash, source_cutoff_at: new Date().toISOString() }).eq("id", version.id).eq("status", "RASCUNHO");
    throwIfSupabaseError(updated.error);
  } else if (version.context_hash !== hash) {
    throw new SpedServiceError("As fontes mudaram após a validação. Reabra a versão antes de validar novamente.", 409, "SOURCE_CHANGED");
  }
  const candidate = {
    competence: context.competence,
    timezoneIana: text(context.config?.timezone_iana),
    gates: buildGateConfiguration(context.config),
    conditionalEvidence: conditionalEvidence(context),
    records,
    unconfirmedEntryIds: context.unconfirmedEntryIds,
  };
  const diagnostics = [
    ...sourceDiagnostics(context, [...projection.diagnostics, ...assessment.diagnostics, ...inventory.diagnostics]),
    ...validateSpedCandidate(candidate, resolveSpedLayout(context.competence)),
  ];
  const begin = await supabaseAdmin.rpc("fiscal_sped_iniciar_validacao", { p_versao_id: version.id, p_context_hash: hash, p_usuario_id: actorId });
  throwIfSupabaseError(begin.error);
  await replaceDiagnostics(number(begin.data), diagnostics);
  const concluded = await supabaseAdmin.rpc("fiscal_sped_concluir_validacao", { p_execucao_id: begin.data, p_usuario_id: actorId });
  throwIfSupabaseError(concluded.error);
  competence = await getCompetence(id);
  return { data: await getSpedCompetenceDetail(id), validation: concluded.data, blocked: hasBlockingDiagnostics(diagnostics) };
}

export async function closeSpedCompetence(id: string, expectedVersion: unknown, actorId: string) {
  await validateSpedCompetence(id, expectedVersion, actorId);
  const competence = await getCompetence(id);
  const version = await getVersion(competence.versao_atual_id);
  if (!version || competence.status !== "APTA") throw new SpedServiceError("A competência possui bloqueios e não pode ser fechada.", 422, "NOT_READY");
  const result = await supabaseAdmin.rpc("fiscal_sped_fechar_versao", {
    p_competencia_id: competence.id,
    p_versao_id: version.id,
    p_expected_lock_version: competence.lock_version,
    p_context_hash: version.context_hash,
    p_usuario_id: actorId,
  });
  throwIfSupabaseError(result.error);
  return getSpedCompetenceDetail(id);
}

export async function reopenSpedCompetence(id: string, expectedVersion: unknown, actorId: string, reason: unknown) {
  const competence = await getCompetence(id);
  const version = await getVersion(competence.versao_atual_id);
  assertExpectedVersion(version, expectedVersion);
  const reasonText = text(reason);
  if (!reasonText) throw new SpedServiceError("Motivo da reabertura é obrigatório.", 400, "REASON_REQUIRED");
  const context = await sourceContext(competence);
  const projection = projectDocuments(context);
  const inventory = projectSpedInventory({
    applicable: context.config?.inventario_aplicavel === true,
    inventory: context.inventory,
    items: context.inventoryItems,
    competenceEnd: context.end,
  });
  const assessment = projectSpedAssessment({
    competence: context.competence,
    documents: projection.documents,
    priorEfd: context.priorEfd,
    adjustments: context.adjustments,
  });
  const records = context.company ? buildFoundationRecords({
    competence: context.competence,
    company: context.company,
    config: context.config,
    accountant: context.accountant,
    payments1601: context.payments1601,
    catalogRecords: [...projection.catalogRecords, ...inventory.catalogRecords],
    blockCRecords: projection.blockCRecords,
    blockERecords: assessment.blockERecords,
    blockHRecords: inventory.records,
  }) : [];
  const hash = contextHash(context, records, projection.documents);
  const result = await supabaseAdmin.rpc("fiscal_sped_reabrir_competencia", {
    p_competencia_id: competence.id,
    p_expected_lock_version: competence.lock_version,
    p_usuario_id: actorId,
    p_motivo: reasonText,
    p_leiaute: "020",
    p_guia_pratico: PRACTICAL_GUIDE,
    p_motor_versao: ENGINE_VERSION,
    p_git_commit: gitCommit(),
    p_source_cutoff_at: new Date().toISOString(),
    p_context_hash: hash,
  });
  throwIfSupabaseError(result.error);
  const newVersion = await getVersion(result.data);
  if (newVersion) {
    await storeDocumentSnapshots(newVersion, projection.documents, records, assessment);
    await storeRecords(newVersion, records);
  }
  return getSpedCompetenceDetail(id);
}

export async function generateSpedFile(id: string, expectedVersion: unknown, actorId: string) {
  const competence = await getCompetence(id);
  const version = await getVersion(competence.versao_atual_id);
  assertExpectedVersion(version, expectedVersion);
  if (!version || version.status !== "FECHADA" || competence.status !== "FECHADA") {
    throw new SpedServiceError("O TXT final só pode ser gerado de uma versão fechada.", 422, "VERSION_NOT_CLOSED");
  }
  const records = await readStoredRecords(number(version.id));
  if (records.length === 0) throw new SpedServiceError("Snapshots da versão não contêm registros EFD.", 422, "SNAPSHOT_EMPTY");
  const serialized = serializeEfd(records, resolveSpedLayout(month(competence.competencia)));
  const hash = sha256Hex(serialized.bytes);
  const existing = await supabaseAdmin.from("fiscal_sped_arquivo").select("id").eq("versao_id", version.id).eq("arquivo_sha256", hash).maybeSingle();
  throwIfSupabaseError(existing.error);
  if (!existing.data) {
    const last = await supabaseAdmin.from("fiscal_sped_arquivo").select("sequencia").eq("versao_id", version.id).order("sequencia", { ascending: false }).limit(1).maybeSingle();
    throwIfSupabaseError(last.error);
    const sequence = number(last.data?.sequencia) + 1;
    const path = `${competence.empresa_id}/${month(competence.competencia)}/v${version.numero}/${sequence}-${hash}.txt`;
    const upload = await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(path, serialized.bytes, { contentType: "text/plain", upsert: false });
    throwIfSupabaseError(upload.error);
    const inserted = await supabaseAdmin.from("fiscal_sped_arquivo").insert({
      versao_id: version.id,
      sequencia: sequence,
      tipo: "FINAL",
      finalidade: version.finalidade,
      storage_bucket: STORAGE_BUCKET,
      storage_path: path,
      arquivo_sha256: hash,
      tamanho_bytes: serialized.bytes.byteLength,
      quantidade_registros: serialized.lineCount,
      contadores_registro: serialized.recordCounts,
      generated_by: actorId,
    });
    if (inserted.error) {
      await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([path]);
      throwIfSupabaseError(inserted.error);
    }
  }
  return getSpedCompetenceDetail(id);
}

function gateViews(config: Row | null): SpedGateView[] {
  const evidence = config?.evidencias ?? {};
  return [
    ["perfil", "PERFIL_EFD", "Perfil EFD", "perfil_efd_status"],
    ["timezone", "TIMEZONE", "Timezone do estabelecimento", "timezone_status"],
    ["atividade", "IND_ATIV", "Indicador de atividade", "indicador_atividade_status"],
    ["bloco-k", "BLOCO_K", "Obrigatoriedade do Bloco K", "bloco_k_status"],
    ["1400", "REG_1400", "Aplicabilidade do registro 1400", "registro_1400_status"],
    ["c176-c179", "C176_C179", "Aplicabilidade de C176/C179", "c176_c179_status"],
    ["1601", "REG_1601", "Aplicabilidade do registro 1601", "registro_1601_status"],
    ["inventario", "INVENTARIO", "Aplicabilidade do inventário/Bloco H", "inventario_status"],
    ["ipi", "CONTRIBUINTE_IPI", "Contribuinte de IPI", "contribuinte_ipi_status"],
    ["efd-contribuicoes", "EFD_CONTRIB", "Entrega da EFD-Contribuições", "entrega_efd_contribuicoes_status"],
  ].map(([id, codigo, titulo, field]) => {
    const value = evidence?.[id];
    const details = value && typeof value === "object" ? value : null;
    return {
      id,
      codigo,
      titulo,
      status: gateStatus(config?.[field]),
      evidencia: details ? text(details.descricao) || null : text(value) || null,
      confirmadoEm: details?.confirmadoEm ?? null,
      confirmadoPor: details?.confirmadoPor ?? null,
    };
  });
}

async function latestExecution(competenceId: number) {
  const result = await supabaseAdmin.from("fiscal_sped_validacao_execucao").select("*").eq("competencia_id", competenceId).order("iniciado_at", { ascending: false }).limit(1).maybeSingle();
  throwIfSupabaseError(result.error);
  return result.data as Row | null;
}

async function summaryFor(competence: Row): Promise<SpedCompetenciaSummary> {
  const version = await getVersion(competence.versao_atual_id);
  const [config, execution, documents, entries, outputs, participants, items, files] = await Promise.all([
    getConfig(number(competence.empresa_id)), latestExecution(number(competence.id)),
    version ? supabaseAdmin.from("fiscal_sped_documento_snapshot").select("id", { count: "exact", head: true }).eq("versao_id", version.id) : Promise.resolve({ count: 0, error: null }),
    version ? supabaseAdmin.from("fiscal_sped_documento_snapshot").select("id", { count: "exact", head: true }).eq("versao_id", version.id).eq("operacao", "ENTRADA") : Promise.resolve({ count: 0, error: null }),
    version ? supabaseAdmin.from("fiscal_sped_documento_snapshot").select("id", { count: "exact", head: true }).eq("versao_id", version.id).eq("operacao", "SAIDA") : Promise.resolve({ count: 0, error: null }),
    version ? supabaseAdmin.from("fiscal_sped_cadastro_snapshot").select("id", { count: "exact", head: true }).eq("versao_id", version.id).eq("tipo", "PARTICIPANTE") : Promise.resolve({ count: 0, error: null }),
    version ? supabaseAdmin.from("fiscal_sped_cadastro_snapshot").select("id", { count: "exact", head: true }).eq("versao_id", version.id).eq("tipo", "ITEM") : Promise.resolve({ count: 0, error: null }),
    version ? supabaseAdmin.from("fiscal_sped_arquivo").select("id", { count: "exact", head: true }).eq("versao_id", version.id) : Promise.resolve({ count: 0, error: null }),
  ]);
  for (const result of [documents, entries, outputs, participants, items, files]) throwIfSupabaseError(result.error);
  return {
    id: String(competence.id), competencia: month(competence.competencia), status: competence.status,
    layout: text(version?.leiaute) || "020", finalidade: version?.finalidade === "RETIFICADORA" ? "RETIFICADORA" : "ORIGINAL",
    versao: version ? number(version.numero) : null, updatedAt: competence.updated_at ?? null,
    contagens: { total: documents.count ?? 0, entradas: entries.count ?? 0, saidas: outputs.count ?? 0, cancelados: 0, participantes: participants.count ?? 0, itens: items.count ?? 0 },
    diagnosticos: { bloqueios: number(execution?.quantidade_bloqueios), erros: number(execution?.quantidade_erros), avisos: number(execution?.quantidade_avisos), informacoes: number(execution?.quantidade_informacoes) },
    gates: gateViews(config), arquivoDisponivel: (files.count ?? 0) > 0,
  };
}

export async function listSpedCompetences(): Promise<SpedCompetenciaSummary[]> {
  const result = await supabaseAdmin.from("fiscal_sped_competencia").select("*").order("competencia", { ascending: false });
  throwIfSupabaseError(result.error);
  return Promise.all((result.data ?? []).map((row: Row) => summaryFor(row)));
}

export async function getSpedCompetenceDetail(id: string): Promise<SpedCompetenciaDetail> {
  const competence = await getCompetence(id);
  const version = await getVersion(competence.versao_atual_id);
  const summary = await summaryFor(competence);
  const config = await getConfig(number(competence.empresa_id));
  const selectedInventoryId = number(config?.inventario_fechamento_id);
  const [companyResult, previousEfdResult, documentsResult, cadastrosResult, apuracaoResult, importsResult, adjustmentsResult, inventoryResult, execution, filesResult, accountantsResult] = await Promise.all([
    supabaseAdmin.from("empresa").select("id, cnpj, razaosocial, nomefantasia, inscricaoestadual").eq("id", competence.empresa_id).maybeSingle(),
    supabaseAdmin.from("fiscal_sped_efd_anterior_importacao").select("id, competencia_arquivo, nome_arquivo, arquivo_sha256, status, imported_at").eq("competencia_id", competence.id).order("imported_at", { ascending: false }).limit(1).maybeSingle(),
    version ? supabaseAdmin.from("fiscal_sped_documento_snapshot").select("*, itens:fiscal_sped_item_snapshot(*)").eq("versao_id", version.id).order("data_emissao_civil").order("id") : Promise.resolve({ data: [], error: null }),
    version ? supabaseAdmin.from("fiscal_sped_cadastro_snapshot").select("*").eq("versao_id", version.id).in("tipo", ["PARTICIPANTE", "ITEM"]).order("id") : Promise.resolve({ data: [], error: null }),
    version ? supabaseAdmin.from("fiscal_sped_apuracao_snapshot").select("*").eq("versao_id", version.id).order("id") : Promise.resolve({ data: [], error: null }),
    supabaseAdmin.from("fiscal_sped_1601_importacao").select("id, nome_arquivo, arquivo_sha256, status, quantidade_linhas, imported_at").eq("competencia_id", competence.id).eq("status", "VALIDADA").order("imported_at", { ascending: false }),
    supabaseAdmin.from("fiscal_sped_ajuste_apuracao").select("*").eq("competencia_id", competence.id).eq("ativo", true).order("id"),
    selectedInventoryId
      ? supabaseAdmin.from("fiscal_inventario_fechamento").select("*").eq("id", selectedInventoryId).eq("empresa_id", competence.empresa_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    latestExecution(number(competence.id)),
    version ? supabaseAdmin.from("fiscal_sped_arquivo").select("*").eq("versao_id", version.id).order("sequencia", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    supabaseAdmin.from("fiscal_sped_contabilista").select("*").eq("empresa_id", competence.empresa_id).order("vigencia_inicio", { ascending: false }),
  ]);
  for (const result of [companyResult, previousEfdResult, documentsResult, cadastrosResult, apuracaoResult, importsResult, adjustmentsResult, inventoryResult, filesResult, accountantsResult]) throwIfSupabaseError(result.error);
  const importIds = (importsResult.data ?? []).map((row: Row) => row.id);
  const payments = importIds.length ? await supabaseAdmin.from("fiscal_sped_1601_linha").select("*").in("importacao_id", importIds).order("id") : { data: [], error: null };
  throwIfSupabaseError(payments.error);
  const inventoryItems = inventoryResult.data
    ? await supabaseAdmin.from("fiscal_inventario_item").select("id, valor_total").eq("inventario_id", inventoryResult.data.id)
    : { data: [], error: null };
  throwIfSupabaseError(inventoryItems.error);
  const inconsistencies = execution ? await supabaseAdmin.from("fiscal_sped_inconsistencia").select("*").eq("execucao_id", execution.id).order("id") : { data: [], error: null };
  throwIfSupabaseError(inconsistencies.error);
  const company = (companyResult.data ?? {}) as Row;
  const cadastros = (cadastrosResult.data ?? []) as Row[];
  const apuracaoRow = ((apuracaoResult.data ?? []) as Row[]).find((row) => row.tipo === "ICMS_PROPRIO");
  const apuracao = (apuracaoRow?.payload ?? {}) as Row;
  return {
    ...summary,
    configuracao: {
      empresaId: number(company.id), estabelecimento: text(company.razaosocial || company.nomefantasia),
      cnpj: text(company.cnpj), inscricaoEstadual: company.inscricaoestadual ?? null,
      timezoneIana: text(config?.timezone_iana), timezoneStatus: gateStatus(config?.timezone_status),
      perfil: config?.perfil_efd ?? null, perfilStatus: gateStatus(config?.perfil_efd_status),
      indicadorAtividade: config?.indicador_atividade ?? null,
      indicadorAtividadeStatus: gateStatus(config?.indicador_atividade_status),
      blocoKObrigatorio: typeof config?.bloco_k_obrigatorio === "boolean" ? config.bloco_k_obrigatorio : null,
      blocoKStatus: gateStatus(config?.bloco_k_status),
      registro1400Aplicavel: typeof config?.registro_1400_aplicavel === "boolean" ? config.registro_1400_aplicavel : null,
      registro1400Status: gateStatus(config?.registro_1400_status),
      c176C179Aplicavel: typeof config?.c176_c179_aplicavel === "boolean" ? config.c176_c179_aplicavel : null,
      c176C179Status: gateStatus(config?.c176_c179_status),
      registro1601Aplicavel: typeof config?.registro_1601_aplicavel === "boolean" ? config.registro_1601_aplicavel : null,
      registro1601Status: gateStatus(config?.registro_1601_status),
      inventarioAplicavel: typeof config?.inventario_aplicavel === "boolean" ? config.inventario_aplicavel : null,
      inventarioStatus: gateStatus(config?.inventario_status),
      inventarioFechamentoId: config?.inventario_fechamento_id == null ? null : number(config.inventario_fechamento_id),
      contribuinteIpi: typeof config?.contribuinte_ipi === "boolean" ? config.contribuinte_ipi : null,
      contribuinteIpiStatus: gateStatus(config?.contribuinte_ipi_status),
      entregaEfdContribuicoes: typeof config?.entrega_efd_contribuicoes === "boolean" ? config.entrega_efd_contribuicoes : null,
      entregaEfdContribuicoesStatus: gateStatus(config?.entrega_efd_contribuicoes_status),
      evidencias: config?.evidencias && typeof config.evidencias === "object" ? config.evidencias : {},
    },
    documentos: ((documentsResult.data ?? []) as Row[]).map((row) => ({
      id: String(row.id),
      direcao: row.operacao,
      modelo: row.modelo,
      serie: text(row.payload?.serie),
      numero: text(row.payload?.numero),
      chave: row.chave_acesso,
      participante: text(row.payload?.participanteNome || row.participante_codigo),
      documentoParticipante: row.participante_documento_canonico,
      dataFiscal: row.data_escrituracao_civil || row.data_emissao_civil,
      situacao: row.codigo_situacao,
      cfops: Array.isArray(row.payload?.cfops) ? row.payload.cfops : [],
      valorTotal: number(row.payload?.valorTotal),
      fonteTabela: row.fonte_tabela,
      fonteId: row.fonte_id,
      fiscalDfeDocumentoId: row.payload?.fiscalDfeDocumentoId ?? null,
      itens: ((row.itens ?? []) as Row[]).sort((left, right) => number(left.numero_item) - number(right.numero_item)).map((item) => ({
        id: String(item.id),
        numero: number(item.numero_item),
        produtoId: item.produto_id == null ? null : number(item.produto_id),
        itemConfigId: item.item_config_id == null ? null : number(item.item_config_id),
        codigo: text(item.codigo_item),
        codigoXml: text(item.payload?.produtoid) || null,
        descricao: text(item.payload?.descricao),
        tipoItem: text(item.payload?.assignment?.itemType) || null,
        unidade: text(item.unidade_documento),
        tratamentoCredito: item.tratamento_credito,
      })),
      fontes: Array.isArray(row.source_refs) ? row.source_refs : [],
    })),
    participantes: cadastros.filter((row) => row.tipo === "PARTICIPANTE").map((row) => ({ id: String(row.id), codigo: row.codigo, nome: text(row.payload?.nome), documento: row.documento_canonico, inscricaoEstadual: row.payload?.inscricaoEstadual ?? null, municipio: row.payload?.municipio ?? null, pais: row.payload?.pais ?? null, documentosReferenciados: number(row.payload?.documentosReferenciados), fontes: row.source_refs ?? [] })),
    itens: cadastros.filter((row) => row.tipo === "ITEM").map((row) => ({ id: String(row.id), codigo: row.codigo, descricao: text(row.payload?.descricao), tipoItem: row.payload?.tipoItem ?? null, ncm: row.payload?.ncm ?? null, cest: row.payload?.cest ?? null, unidade: row.payload?.unidade ?? null, documentosReferenciados: number(row.payload?.documentosReferenciados), possui0220: Boolean(row.payload?.possui0220), possui0221: Boolean(row.payload?.possui0221), fontes: row.source_refs ?? [] })),
    apuracao: { saldoCredorAnterior: number(apuracao.saldoCredorAnterior), totalDebitos: number(apuracao.totalDebitos), totalCreditos: number(apuracao.totalCreditos), totalAjustes: number(apuracao.totalAjustes), impostoRecolher: number(apuracao.impostoRecolher), saldoTransportar: number(apuracao.saldoTransportar), linhas: Array.isArray(apuracao.linhas) ? apuracao.linhas : [] },
    ajustes: ((adjustmentsResult.data ?? []) as Row[]).map((row) => ({
      id: String(row.id),
      registroDestino: row.registro_destino,
      natureza: row.natureza,
      codigo: row.codigo_ajuste,
      uf: row.uf,
      valor: number(row.valor),
      descricao: row.descricao,
      evidencia: row.evidencia,
      numeroDocumento: row.numero_documento,
      referencia: row.referencia ?? {},
      criadoEm: row.created_at,
    })),
    pagamentos1601: ((payments.data ?? []) as Row[]).map((row) => ({ id: String(row.id), instituicao: row.instituicao_nome, documentoInstituicao: row.instituicao_cnpj, intermediario: row.intermediario_nome, documentoIntermediario: row.intermediario_cnpj, totalOperacoes: number(row.total_operacoes), totalIss: number(row.total_iss), totalOutros: number(row.total_outros), origem: "CSV", importadoEm: null })),
    importacoes: {
      efdAnterior: previousEfdResult.data ? {
        id: String(previousEfdResult.data.id),
        competencia: month(previousEfdResult.data.competencia_arquivo),
        nome: previousEfdResult.data.nome_arquivo,
        sha256: previousEfdResult.data.arquivo_sha256,
        status: previousEfdResult.data.status,
        importadoEm: previousEfdResult.data.imported_at,
      } : null,
      registros1601: ((importsResult.data ?? []) as Row[]).map((row) => ({
        id: String(row.id), nome: row.nome_arquivo, sha256: row.arquivo_sha256,
        status: row.status, quantidadeLinhas: number(row.quantidade_linhas), importadoEm: row.imported_at,
      })),
    },
    inventario: {
      aplicabilidade: gateStatus(config?.inventario_status),
      dataInventario: inventoryResult.data?.data_inventario ?? null,
      motivo: inventoryResult.data?.motivo ?? null,
      status: inventoryResult.data?.status ?? null,
      quantidadeItens: (inventoryItems.data ?? []).length,
      valorTotal: (inventoryItems.data ?? []).reduce((sum: number, row: Row) => sum + number(row.valor_total), 0),
      atualizadoEm: inventoryResult.data?.updated_at ?? null,
    },
    inconsistencias: ((inconsistencies.data ?? []) as Row[]).map((row) => ({ id: String(row.id), severidade: row.severidade, codigo: row.codigo, titulo: row.codigo.replaceAll("_", " "), mensagem: row.mensagem, registro: row.registro_efd, campo: row.campo_efd, resolvida: row.status === "RESOLVIDA", reconhecida: row.status === "RECONHECIDA", criadoEm: row.created_at, fontes: row.referencia_origem ? [row.referencia_origem] : [] })),
    arquivos: ((filesResult.data ?? []) as Row[]).map((row) => ({ id: String(row.id), nome: text(row.storage_path).split("/").pop() || `sped-${row.id}.txt`, tipo: row.tipo, finalidade: row.finalidade, versao: number(version?.numero), layout: text(version?.leiaute), quantidadeRegistros: number(row.quantidade_registros), tamanhoBytes: number(row.tamanho_bytes), sha256: row.arquivo_sha256, geradoEm: row.generated_at, geradoPor: row.generated_by, pvaStatus: null })),
    contabilistas: ((accountantsResult.data ?? []) as Row[]).map(toSpedContabilista),
    auditoria: [], sourceCutoffAt: version?.source_cutoff_at ?? null, contextHash: version?.context_hash ?? null,
  };
}

export async function getSpedFileSignedUrl(fileId: string) {
  const result = await supabaseAdmin.from("fiscal_sped_arquivo").select("id, storage_bucket, storage_path").eq("id", assertId(fileId)).maybeSingle();
  throwIfSupabaseError(result.error);
  if (!result.data) throw new SpedServiceError("Arquivo SPED não encontrado.", 404, "NOT_FOUND");
  const signed = await supabaseAdmin.storage.from(result.data.storage_bucket).createSignedUrl(result.data.storage_path, 60);
  throwIfSupabaseError(signed.error);
  if (!signed.data?.signedUrl) {
    throw new SpedServiceError("Não foi possível assinar o download do arquivo SPED.", 500, "SIGNED_URL_ERROR");
  }
  return { url: signed.data.signedUrl, expiresIn: 60 };
}

const CONFIG_FIELDS = new Set([
  "timezone_iana", "timezone_status", "perfil_efd", "perfil_efd_status",
  "indicador_atividade", "indicador_atividade_status", "bloco_k_obrigatorio",
  "bloco_k_status", "registro_1400_aplicavel", "registro_1400_status",
  "c176_c179_aplicavel", "c176_c179_status", "contribuinte_ipi",
  "registro_1601_aplicavel", "registro_1601_status",
  "inventario_aplicavel", "inventario_status", "inventario_fechamento_id",
  "contribuinte_ipi_status", "entrega_efd_contribuicoes",
  "entrega_efd_contribuicoes_status", "evidencias",
]);

export async function getSpedConfiguration(companyId: number) {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new SpedServiceError("Empresa inválida.", 400, "INVALID_COMPANY");
  }
  return getConfig(companyId);
}

export async function updateSpedConfiguration(input: {
  companyId: number;
  actorId: string;
  patch: Record<string, unknown>;
}) {
  const current = await getSpedConfiguration(input.companyId);
  const payload: Row = {
    empresa_id: input.companyId,
    updated_by: input.actorId,
    ...(current ? {} : { created_by: input.actorId }),
  };
  const suppliedEvidence = input.patch.evidencias && typeof input.patch.evidencias === "object"
    ? input.patch.evidencias as Row
    : {};
  for (const [key, value] of Object.entries(input.patch)) {
    if (CONFIG_FIELDS.has(key) && key !== "evidencias") payload[key] = value;
  }

  const statuses = Object.entries(payload).filter(([key]) => key.endsWith("_status"));
  for (const [key, value] of statuses) {
    if (!["PENDENTE", "CONFIRMADO", "NAO_APLICAVEL"].includes(text(value))) {
      throw new SpedServiceError(`Status inválido em ${key}.`, 400, "INVALID_GATE_STATUS");
    }
  }
  if (payload.timezone_iana != null && !isValidIanaTimezone(payload.timezone_iana)) {
    throw new SpedServiceError("Timezone IANA inválida.", 400, "INVALID_TIMEZONE");
  }
  if (payload.perfil_efd != null && !["A", "B", "C"].includes(text(payload.perfil_efd))) {
    throw new SpedServiceError("Perfil EFD inválido.", 400, "INVALID_PROFILE");
  }
  if (payload.indicador_atividade != null && !["0", "1"].includes(text(payload.indicador_atividade))) {
    throw new SpedServiceError("Indicador de atividade inválido.", 400, "INVALID_ACTIVITY");
  }
  if (payload.inventario_fechamento_id != null) {
    const inventoryId = Number(payload.inventario_fechamento_id);
    if (!Number.isSafeInteger(inventoryId) || inventoryId <= 0) {
      throw new SpedServiceError("Fechamento de inventário inválido.", 400, "INVALID_INVENTORY");
    }
    payload.inventario_fechamento_id = inventoryId;
  }
  for (const key of [
    "bloco_k_obrigatorio", "registro_1400_aplicavel", "c176_c179_aplicavel", "registro_1601_aplicavel", "inventario_aplicavel",
    "contribuinte_ipi", "entrega_efd_contribuicoes",
  ]) {
    if (payload[key] != null && typeof payload[key] !== "boolean") {
      throw new SpedServiceError(`Valor booleano inválido em ${key}.`, 400, "INVALID_CONFIG_VALUE");
    }
  }

  const evidenceByStatusField: Record<string, string> = {
    timezone_status: "timezone",
    perfil_efd_status: "perfil",
    indicador_atividade_status: "atividade",
    bloco_k_status: "bloco-k",
    registro_1400_status: "1400",
    c176_c179_status: "c176-c179",
    registro_1601_status: "1601",
    inventario_status: "inventario",
    contribuinte_ipi_status: "ipi",
    entrega_efd_contribuicoes_status: "efd-contribuicoes",
  };
  const mergedEvidence: Row = { ...(current?.evidencias ?? {}) };
  for (const [field, gateId] of Object.entries(evidenceByStatusField)) {
    if (!(field in payload)) continue;
    const nextStatus = text(payload[field]);
    if (nextStatus === "PENDENTE") {
      delete mergedEvidence[gateId];
      continue;
    }
    const supplied = suppliedEvidence[gateId];
    const descricao = typeof supplied === "string"
      ? supplied.trim()
      : text((supplied as Row | undefined)?.descricao);
    if (!descricao) {
      throw new SpedServiceError(`Informe a evidência fiscal do gate ${gateId}.`, 400, "GATE_EVIDENCE_REQUIRED");
    }
    mergedEvidence[gateId] = {
      descricao,
      status: nextStatus,
      confirmadoEm: new Date().toISOString(),
      confirmadoPor: input.actorId,
    };
  }
  payload.evidencias = mergedEvidence;

  if (payload.inventario_fechamento_id != null) {
    const inventory = await supabaseAdmin.from("fiscal_inventario_fechamento")
      .select("id")
      .eq("id", payload.inventario_fechamento_id)
      .eq("empresa_id", input.companyId)
      .eq("status", "APROVADO")
      .maybeSingle();
    throwIfSupabaseError(inventory.error);
    if (!inventory.data) {
      throw new SpedServiceError("O inventário selecionado não está aprovado para este estabelecimento.", 422, "INVENTORY_NOT_APPROVED");
    }
  }

  const result = await supabaseAdmin
    .from("fiscal_sped_config")
    .upsert(payload, { onConflict: "empresa_id" })
    .select("*")
    .single();
  throwIfSupabaseError(result.error);
  return result.data;
}

export async function configureSpedFiscalItem(input: {
  competenceId: string | number;
  itemSnapshotId: string | number;
  canonicalCode?: unknown;
  itemType?: unknown;
  creditTreatment?: unknown;
  evidence: unknown;
  actorId: string;
}) {
  const competence = await getCompetence(input.competenceId);
  if (competence.status === "FECHADA") {
    throw new SpedServiceError("Competência fechada não aceita decisões fiscais.", 409, "COMPETENCE_CLOSED");
  }
  const version = await getVersion(competence.versao_atual_id);
  if (!version) throw new SpedServiceError("Valide a competência para projetar os itens antes de classificá-los.", 409, "VERSION_REQUIRED");
  const itemResult = await supabaseAdmin
    .from("fiscal_sped_item_snapshot")
    .select("*, documento:fiscal_sped_documento_snapshot!inner(*)")
    .eq("id", assertId(input.itemSnapshotId))
    .maybeSingle();
  throwIfSupabaseError(itemResult.error);
  const item = itemResult.data as Row | null;
  const document = item?.documento as Row | null;
  if (!item || !document || number(document.versao_id) !== number(version.id)) {
    throw new SpedServiceError("Item fiscal não pertence à versão atual da competência.", 404, "ITEM_NOT_FOUND");
  }
  const evidence = text(input.evidence);
  if (!evidence) throw new SpedServiceError("A evidência da decisão fiscal é obrigatória.", 400, "EVIDENCE_REQUIRED");

  const productId = number(item.produto_id) || null;
  const canonicalCode = text(input.canonicalCode);
  const itemType = text(input.itemType);
  if (productId && (!canonicalCode || canonicalCode.includes("|") || !/^\d{2}$/.test(itemType))) {
    throw new SpedServiceError("Informe código canônico sem pipe e tipo de item com dois dígitos.", 400, "INVALID_ITEM_CONFIG");
  }
  const isInput = document.operacao === "ENTRADA";
  const creditTreatment = text(input.creditTreatment);
  const allowedCredits = ["CREDITAVEL", "SEM_CREDITO", "USO_CONSUMO", "ATIVO_IMOBILIZADO"];
  if (isInput && !allowedCredits.includes(creditTreatment)) {
    throw new SpedServiceError("Selecione o tratamento de crédito da entrada.", 400, "INVALID_CREDIT_TREATMENT");
  }
  const dfeDocumentId = isInput ? number(document.payload?.fiscalDfeDocumentoId) : 0;
  if (isInput && !dfeDocumentId) {
    throw new SpedServiceError("A entrada não possui DFe íntegro para registrar a decisão de crédito.", 422, "DFE_REQUIRED");
  }
  if (!productId && !isInput) {
    throw new SpedServiceError("O item de saída não possui produto interno vinculado para configurar o 0200.", 422, "PRODUCT_REQUIRED");
  }

  const result = await supabaseAdmin.rpc("fiscal_sped_configurar_item_competencia", {
    p_competencia_id: number(competence.id),
    p_produto_id: productId,
    p_codigo_item: productId ? canonicalCode : null,
    p_tipo_item: productId ? itemType : null,
    p_documento_id: isInput ? dfeDocumentId : null,
    p_numero_item: isInput ? number(item.numero_item) : null,
    p_tratamento_credito: isInput ? creditTreatment : null,
    p_evidencia: evidence,
    p_usuario_id: input.actorId,
  });
  throwIfSupabaseError(result.error);
  return result.data;
}

const ADJUSTMENT_NATURES: Record<string, Set<string>> = {
  E111: new Set(["DEBITO", "CREDITO", "ESTORNO_CREDITO", "ESTORNO_DEBITO", "DEDUCAO", "DEBITO_ESPECIAL"]),
  E115: new Set(["INFORMATIVO"]),
  E116: new Set(["RECOLHIMENTO"]),
  E311: new Set(["DEBITO", "CREDITO", "ESTORNO_CREDITO", "ESTORNO_DEBITO", "DEDUCAO", "DEBITO_ESPECIAL"]),
  E312: new Set(["REFERENCIA"]),
  E313: new Set(["REFERENCIA"]),
  E316: new Set(["RECOLHIMENTO"]),
};

export async function createSpedAssessmentAdjustment(input: {
  competenceId: string | number;
  destination: unknown;
  nature: unknown;
  code: unknown;
  uf?: unknown;
  value: unknown;
  description: unknown;
  evidence: unknown;
  documentNumber?: unknown;
  reference?: unknown;
  actorId: string;
}) {
  const competence = await getCompetence(input.competenceId);
  if (competence.status === "FECHADA") {
    throw new SpedServiceError("Competência fechada não aceita ajustes.", 409, "COMPETENCE_CLOSED");
  }
  const destination = text(input.destination).toUpperCase();
  const nature = text(input.nature).toUpperCase();
  if (!ADJUSTMENT_NATURES[destination]?.has(nature)) {
    throw new SpedServiceError("Registro de destino e natureza do ajuste são incompatíveis.", 400, "INVALID_ADJUSTMENT_TYPE");
  }
  const code = text(input.code);
  const description = text(input.description);
  const evidence = text(input.evidence);
  const value = Number(input.value);
  if (!code || !description || !evidence || !Number.isFinite(value) || value < 0) {
    throw new SpedServiceError("Código, descrição, evidência e valor não negativo são obrigatórios.", 400, "INVALID_ADJUSTMENT");
  }
  const uf = text(input.uf).toUpperCase() || null;
  const requiresUf = ["E311", "E312", "E313", "E316"].includes(destination);
  if (requiresUf !== Boolean(uf) || (uf && !/^[A-Z]{2}$/.test(uf))) {
    throw new SpedServiceError(requiresUf ? "Informe a UF do ajuste DIFAL/FCP." : "A UF só deve ser informada para E311/E312/E313/E316.", 400, "INVALID_ADJUSTMENT_UF");
  }
  const reference = input.reference && typeof input.reference === "object" && !Array.isArray(input.reference)
    ? input.reference as Row
    : {};
  if (["E116", "E316"].includes(destination) && !isValidCivilDate(text(reference.dataVencimento))) {
    throw new SpedServiceError("Informe a data civil de vencimento do recolhimento.", 400, "DUE_DATE_REQUIRED");
  }
  if (destination === "E311" && !["DIFAL", "FCP"].includes(text(reference.tributo).toUpperCase())) {
    throw new SpedServiceError("Informe se o ajuste E311 pertence ao DIFAL ou ao FCP.", 400, "TAX_KIND_REQUIRED");
  }
  const result = await supabaseAdmin.from("fiscal_sped_ajuste_apuracao").insert({
    competencia_id: number(competence.id),
    registro_destino: destination,
    natureza: nature,
    codigo_ajuste: code,
    uf,
    valor: Math.round(value * 100) / 100,
    descricao: description,
    evidencia: evidence,
    numero_documento: text(input.documentNumber) || null,
    referencia: reference,
    created_by: input.actorId,
    updated_by: input.actorId,
  }).select("*").single();
  throwIfSupabaseError(result.error);
  return result.data;
}

export async function deactivateSpedAssessmentAdjustment(input: {
  competenceId: string | number;
  adjustmentId: string | number;
  actorId: string;
}) {
  const competence = await getCompetence(input.competenceId);
  if (competence.status === "FECHADA") {
    throw new SpedServiceError("Competência fechada não aceita alterações em ajustes.", 409, "COMPETENCE_CLOSED");
  }
  const result = await supabaseAdmin.from("fiscal_sped_ajuste_apuracao")
    .update({ ativo: false, updated_by: input.actorId })
    .eq("id", assertId(input.adjustmentId))
    .eq("competencia_id", number(competence.id))
    .eq("ativo", true)
    .select("id")
    .maybeSingle();
  throwIfSupabaseError(result.error);
  if (!result.data) throw new SpedServiceError("Ajuste não encontrado.", 404, "ADJUSTMENT_NOT_FOUND");
  return { id: String(result.data.id) };
}
