import "server-only";

import {
  isValidCivilDate,
  isValidIanaTimezone,
  parseCompetence,
} from "@/lib/fiscal-date";
import {
  hasBlockingDiagnostics,
  resolveSpedLayout,
  resolveSpedLayoutForVersion,
  serializeEfd,
  SpedLayoutNotConfiguredError,
  validateSpedCandidate,
  type EfdLayout,
  type EfdRecord,
  type SpedDiagnostic,
  type SpedGateStatus,
} from "@/lib/sped/efd-icms-ipi";
import {
  corpoDoPatch,
  inventarioAplicavelNaCompetencia,
  planejarDeducao,
  type SpedFatosEmpresa,
} from "@/lib/sped/configuracao-empresa";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { toSpedContabilista } from "./accountantService";
import { SpedServiceError, throwIfSupabaseError } from "./errors";
import { isDfeCancelledOrDenied, singleCompanyId } from "./guards";
import {
  buildSpedStoragePath,
  classifySpedDbInsertError,
  validateSpedFileGenerationPreconditions,
} from "./fileGenerationGuards";
import { projectSpedAssessment, type SpedAssessmentProjection } from "./assessmentProjection";
import {
  planSpedCreditResolution,
  planSpedItemResolution,
  type SpedCreditCandidate,
  type SpedExistingItemConfig,
  type SpedAutoProduct,
  type SpedProductUsage,
} from "./autoResolution";
import { detectC176C179Evidence } from "./conditionalEvidence";
import { deriveTimezoneFromAddress, normalizePolicyPatch, readSpedPolicies } from "./configPolicies";
import { hashStableJson, sha256Hex } from "./hash";
import { projectSpedInventory } from "./inventoryProjection";
import { buildFoundationRecords, buildGateConfiguration, validateFoundation, withPreviewAccountantPlaceholder } from "./projection";
import { mergeSped1010Evidence } from "./indicators1010";
import {
  projectFiscalDocument,
  type ProjectedFiscalDocument,
  type SpedItemAssignment,
} from "./documentProjection";
import { deriveUnitConversions, mergeItemVersions, mergeParticipantVersions, projectSpedCatalog, type SpedEntryUnitUsage } from "./catalogProjection";
import {
  collectSpedSources,
  entryDocumentKey,
  fiscalEmissionCivilDate,
  loadEffectiveConfig,
  productMaster,
  type SpedSourceContext,
} from "./sourceContext";
import { reconcileDocuments } from "./reconciliation";
import { fetchAllPages, type SpedCollectionReport } from "./sourcePagination";
import type {
  SpedCompetenciaDetail,
  SpedCompetenciaSummary,
  SpedGateView,
  SpedPvaStatus,
  SpedPvaValidacao,
} from "./types";

const ENGINE_VERSION = "0.2.0";
const PRACTICAL_GUIDE = "3.2.4";
const STORAGE_BUCKET = "fiscal-sped";

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

function documentXml(row: Row): string {
  return text(row.xml_autorizado || row.xml_assinado || row.dfe?.xml);
}

function documentKey(row: Row): string {
  return text(row.chave_acesso || row.notachave || row.dfe?.chave_acesso) || `SEM-CHAVE-${row.id}`;
}

function effectiveRows(rows: Row[] | undefined, civilDate: string): Row[] {
  return (rows ?? []).filter((row) => {
    const start = text(row.vigencia_inicio).slice(0, 10);
    const end = text(row.vigencia_fim).slice(0, 10);
    return start <= civilDate && (!end || end >= civilDate);
  });
}

function assignmentFromProduct(
  context: SpedSourceContext,
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
  const master = productMaster(context.productsById.get(productId));
  // Sem configuração vigente o item segue identificado pelo produto: a
  // projeção acusa o 0200 pendente e a resolução automática sabe quem é.
  if (!config) return { assignment: { code: "", stock: "PRODUTO", productId, itemConfigId: null, master }, diagnostics: [] };
  return {
    assignment: {
      code: text(config.codigo_item),
      stock: "PRODUTO",
      productId,
      itemConfigId: number(config.id),
      itemType: text(config.tipo_item) || null,
      master,
    },
    diagnostics: [],
  };
}

/**
 * Tipo do 0200 de quem não é produto de venda: o estoque já diz o uso. O geral
 * guarda o que é de terceiros (peça de cliente que veio para conserto), que não
 * é revenda nem consumo.
 */
const SIMPLE_STOCK_ITEM_TYPE: Record<string, { stock: "USOCONSUMO" | "GERAL"; itemType: string }> = {
  USOCONSUMO: { stock: "USOCONSUMO", itemType: "07" },
  GERAL: { stock: "GERAL", itemType: "99" },
};

function assignmentFromSimpleItem(context: SpedSourceContext, simpleItemId: number): SpedItemAssignment {
  const row = context.simpleItemsById.get(simpleItemId);
  const kind = SIMPLE_STOCK_ITEM_TYPE[text(row?.escopo)] ?? SIMPLE_STOCK_ITEM_TYPE.USOCONSUMO;
  return {
    // Prefixo próprio: o id de `usoconsumo_item` não pode colidir com o de produto.
    code: `UC${simpleItemId}`,
    stock: kind.stock,
    productId: null,
    simpleItemId,
    itemConfigId: null,
    itemType: kind.itemType,
    master: productMaster(row),
  };
}

function documentAssignments(
  context: SpedSourceContext,
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

  // Cada item fiscal entrou em um único estoque: produto (P) ou item simples (U).
  const grouped = new Map<number, Set<string>>();
  // Quantidade que entrou no estoque, na unidade do estoque: dá o fator do 0220.
  const stockQuantity = new Map<number, number>();
  for (const item of context.entryStockItemsByDocument.get(entryDocumentKey(row.source_table, row.id)) ?? []) {
    const target = item.productId ? `P:${item.productId}` : item.simpleItemId ? `U:${item.simpleItemId}` : null;
    if (!target) continue;
    grouped.set(item.itemNumber, (grouped.get(item.itemNumber) ?? new Set<string>()).add(target));
    stockQuantity.set(item.itemNumber, (stockQuantity.get(item.itemNumber) ?? 0) + item.quantity);
  }
  for (const [itemNumber, targets] of grouped) {
    if (targets.size > 1) {
      diagnostics.push({
        code: "APROPRIACAO_ITEM_AMBIGUA",
        severity: "BLOQUEIO",
        message: `O item fiscal ${itemNumber} da entrada ${row.id} foi apropriado para itens de estoque diferentes.`,
        source: { source: "BANCO", table: row.source_table, id: row.id, documentKey: documentKey(row) },
      });
      continue;
    }
    const [kind, id] = Array.from(targets)[0].split(":");
    const quantity = stockQuantity.get(itemNumber) ?? null;
    if (kind === "U") {
      assignments.set(itemNumber, { ...assignmentFromSimpleItem(context, Number(id)), stockQuantity: quantity });
      continue;
    }
    const resolved = assignmentFromProduct(context, Number(id), civilDate);
    diagnostics.push(...resolved.diagnostics);
    if (resolved.assignment) assignments.set(itemNumber, { ...resolved.assignment, stockQuantity: quantity });
  }

  // A decisão de crédito é do item fiscal do DF-e, com ou sem produto vinculado.
  const dfeId = number(row.fiscal_dfe_documento_id);
  const prefix = `${dfeId}:`;
  for (const [key, rows] of context.creditDecisionsByItem) {
    if (!key.startsWith(prefix)) continue;
    const itemNumber = number(key.slice(prefix.length));
    const decisions = effectiveRows(rows, civilDate);
    if (decisions.length > 1) {
      diagnostics.push({
        code: "DECISAO_CREDITO_VIGENCIA_SOBREPOSTA",
        severity: "BLOQUEIO",
        message: `O item ${itemNumber} do DFe ${dfeId} possui decisões de crédito sobrepostas em ${civilDate}.`,
        source: { source: "CONFIGURACAO", table: "fiscal_sped_item_credito_decisao", id: decisions[0].id },
      });
      continue;
    }
    if (!decisions[0]) continue;
    const assignment = assignments.get(itemNumber) ?? { code: "", productId: null, itemConfigId: null };
    assignment.creditTreatment = text(decisions[0].tratamento_credito);
    assignments.set(itemNumber, assignment);
  }
  return { assignments, diagnostics };
}

function catalogIdentity(record: EfdRecord): string | null {
  if (record.code === "0150") return `${record.code}|${text(record.values.COD_PART)}`;
  if (record.code === "0190") return `${record.code}|${text(record.values.UNID)}`;
  if (record.code === "0200") return `${record.code}|${text(record.values.COD_ITEM)}`;
  return null;
}

function projectDocuments(context: SpedSourceContext) {
  const documents: ProjectedFiscalDocument[] = [];
  const diagnostics: SpedDiagnostic[] = [...context.mappingDiagnostics];
  const rejected = new Set<string>();
  const policies = readSpedPolicies(context.config);
  for (const row of context.noteRows) {
    const xml = documentXml(row);
    if (!xml) {
      rejected.add(`nfe:${row.id}`);
      continue;
    }
    const civilDate = fiscalEmissionCivilDate(row) ?? context.start;
    const mapped = documentAssignments(context, row, "SAIDA", civilDate);
    diagnostics.push(...mapped.diagnostics);
    const model = text(row.modelo).toUpperCase();
    try {
      documents.push(projectFiscalDocument({
        sourceType: ["65", "NFCE", "NFC_E", "NFC-E"].includes(model) ? "NFC_E" : "NFE_EMITIDA",
        sourceTable: "nfe",
        sourceId: row.id,
        operation: "SAIDA",
        ownIssued: true,
        status: text(row.status),
        xml,
        xmlSha256: sha256Hex(xml),
        itemAssignments: mapped.assignments,
      }));
    } catch (error) {
      rejected.add(`nfe:${row.id}`);
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
    const sourceKey = entryDocumentKey(row.source_table, row.id);
    if (!xml) {
      rejected.add(sourceKey);
      continue;
    }
    if (isDfeCancelledOrDenied(row.dfe)) {
      rejected.add(sourceKey);
      diagnostics.push({
        code: "ENTRADA_NFE_CANCELADA",
        severity: "BLOQUEIO",
        message: `A entrada ${row.id} usa a NF-e ${documentKey(row)}, que está ${text(row.dfe?.status).toLowerCase()} na SEFAZ. Documento cancelado ou denegado do fornecedor não é escriturado: cancele a entrada ou vincule a nota correta.`,
        source: { source: "BANCO", table: row.source_table, id: row.id, documentKey: documentKey(row) },
      });
      continue;
    }
    const civilDate = text(row.data_entrada_fiscal).slice(0, 10);
    const mapped = documentAssignments(context, row, "ENTRADA", civilDate);
    diagnostics.push(...mapped.diagnostics);
    try {
      documents.push(projectFiscalDocument({
        sourceType: "NFE_RECEBIDA",
        sourceTable: row.source_table,
        sourceId: row.id,
        operation: "ENTRADA",
        ownIssued: false,
        status: text(row.dfe?.status || row.status),
        xml,
        xmlSha256: sha256Hex(xml),
        receivedDocumentId: number(row.fiscal_dfe_documento_id) || null,
        bookkeepingDate: civilDate,
        itemAssignments: mapped.assignments,
        csosnToCst: policies.csosnToCst,
      }));
    } catch (error) {
      rejected.add(sourceKey);
      diagnostics.push({
        code: "XML_FISCAL_INVALIDO",
        severity: "BLOQUEIO",
        message: `Não foi possível projetar a entrada ${row.id}: ${error instanceof Error ? error.message : "erro desconhecido"}`,
        source: { source: "XML", table: row.source_table, id: row.id, documentKey: documentKey(row) },
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
  // Participante e item aparecem uma vez no arquivo: as versões de cada nota se juntam.
  const participantVersions = new Map<string, Array<{ record: EfdRecord; date: string }>>();
  const itemVersions = new Map<string, Array<{ record: EfdRecord; date: string }>>();
  const blockCRecords: EfdRecord[] = [];
  for (const document of uniqueDocuments) {
    diagnostics.push(...document.diagnostics);
    blockCRecords.push(...document.blockCRecords);
    const date = document.bookkeepingDate || document.emissionDate.civilDate;
    for (const record of document.catalogRecords) {
      const identity = catalogIdentity(record);
      if (!identity) continue;
      const versions = record.code === "0150" ? participantVersions : record.code === "0200" ? itemVersions : null;
      if (versions) {
        versions.set(identity, [...(versions.get(identity) ?? []), { record, date }]);
        continue;
      }
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
  const mergedCatalogRecords: EfdRecord[] = [];
  for (const versions of participantVersions.values()) {
    const merged = mergeParticipantVersions(versions);
    mergedCatalogRecords.push(...merged.records);
    diagnostics.push(...merged.diagnostics);
  }
  for (const versions of itemVersions.values()) {
    const merged = mergeItemVersions(versions);
    mergedCatalogRecords.push(merged.record);
    diagnostics.push(...merged.diagnostics);
  }
  const reconciliation = reconcileDocuments({
    sourceNotes: context.noteRows.length,
    sourceEntries: context.entryRows.length,
    projected: uniqueDocuments.length,
    rejected: rejected.size,
    duplicates: documents.length - uniqueDocuments.length,
    c100: blockCRecords.filter((record) => record.code === "C100").length,
  });
  diagnostics.push(...reconciliation.diagnostics);
  return {
    documents: uniqueDocuments,
    catalogRecords: [...mergedCatalogRecords, ...catalogs.values()],
    blockCRecords,
    diagnostics,
    reconciliation: reconciliation.summary,
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
  context: SpedSourceContext,
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
    message: `A NF-e ${documentKey(row)} está com situação ${text(row.status)} e precisa ser resolvida na SEFAZ antes do fechamento.`,
    source: { source: "BANCO", table: "nfe", id: row.id, documentKey: documentKey(row) },
  });
  for (const row of [...context.noteRows, ...context.entryRows]) {
    if (!documentXml(row)) diagnostics.push({
      code: "XML_FISCAL_AUSENTE",
      severity: "BLOQUEIO",
      message: `O documento ${documentKey(row)} não possui XML completo preservado.`,
      source: {
        source: "BANCO",
        table: row.source_table ?? "nfe",
        id: row.id,
        documentKey: documentKey(row),
      },
    });
  }
  return diagnostics;
}

function contextHash(
  context: SpedSourceContext,
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
    entries: context.entryRows.map((row) => ({ table: row.source_table, id: row.id, date: row.data_entrada_fiscal, status: row.status, key: documentKey(row), xmlHash: documentXml(row) ? sha256Hex(documentXml(row)) : null })),
    priorEfd: context.priorEfd,
    payments1601: context.payments1601,
    adjustments: context.adjustments,
    unitConversions: context.unitConversions,
    itemCorrelations: context.itemCorrelations,
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

async function openVersion(competence: Row, actorId: string, hash: string, layout: EfdLayout): Promise<Row> {
  const result = await supabaseAdmin.rpc("fiscal_sped_abrir_versao", {
    p_competencia_id: number(competence.id),
    p_finalidade: "ORIGINAL",
    p_leiaute: layout.code,
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
  catalogMeta?: { itemsWith0220?: Set<string>; itemsWith0221?: Set<string> },
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
        possui0220: catalogMeta?.itemsWith0220?.has(code) ?? false,
        possui0221: catalogMeta?.itemsWith0221?.has(code) ?? false,
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
  catalogMeta?: { itemsWith0220?: Set<string>; itemsWith0221?: Set<string> },
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
    p_cadastros: catalogSnapshotRows(records, documents, catalogMeta),
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
  // Lotes de 500: uma competência grande pode ter milhares de diagnósticos.
  for (let index = 0; index < diagnostics.length; index += 500) {
    await insertDiagnostics(executionId, diagnostics.slice(index, index + 500));
  }
}

async function insertDiagnostics(executionId: number, diagnostics: SpedDiagnostic[]) {
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

export async function resolveCompanyId(companyId: number | null | undefined): Promise<number> {
  if (companyId != null) return companyId;
  const result = await supabaseAdmin.from("empresa").select("id").order("id").limit(2);
  throwIfSupabaseError(result.error);
  const chosen = singleCompanyId(((result.data ?? []) as Row[]).map((row) => number(row.id)));
  if ("id" in chosen) return chosen.id;
  throw chosen.error === "NENHUMA"
    ? new SpedServiceError("Cadastre a empresa antes de abrir uma competência SPED.", 422, "COMPANY_REQUIRED")
    : new SpedServiceError("Há mais de uma empresa cadastrada: informe a empresa da competência.", 400, "COMPANY_AMBIGUOUS");
}

/** Cria (ou reaproveita) a competência e devolve só o estado, sem o detalhe completo. */
export async function ensureSpedCompetenceState(input: { companyId: number; competence: string; actorId: string }) {
  let start: string;
  try {
    start = parseCompetence(input.competence).start;
  } catch (error) {
    throw new SpedServiceError(error instanceof Error ? error.message : "Competência inválida.", 400, "INVALID_COMPETENCE");
  }
  const result = await supabaseAdmin.rpc("fiscal_sped_criar_competencia", {
    p_empresa_id: input.companyId,
    p_competencia: start,
    p_usuario_id: input.actorId,
  });
  throwIfSupabaseError(result.error);
  return getSpedCompetenceState(String(result.data));
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

/** Etapas reais do processamento, reportadas conforme acontecem. */
export type SpedProgressStage =
  | "COLETANDO_DOCUMENTOS"
  | "RESOLVENDO_CADASTROS"
  | "CALCULANDO_APURACAO"
  | "MONTANDO_REGISTROS"
  | "VALIDANDO";
export type SpedProgress = (stage: SpedProgressStage) => Promise<void> | void;

function layoutFor(competence: string, versionLayoutCode?: string | null): EfdLayout {
  try {
    return versionLayoutCode ? resolveSpedLayoutForVersion(competence, versionLayoutCode) : resolveSpedLayout(competence);
  } catch (error) {
    if (error instanceof SpedLayoutNotConfiguredError) throw new SpedServiceError(error.message, 422, error.code);
    throw new SpedServiceError(error instanceof Error ? error.message : "Leiaute inválido.", 422, "LEIAUTE_INVALIDO");
  }
}

async function buildCompetenceProjection(
  context: SpedSourceContext,
  options: { layout: EfdLayout; finalidade: "ORIGINAL" | "RETIFICADORA"; progress?: SpedProgress },
) {
  const projection = projectDocuments(context);
  const inventory = projectSpedInventory({
    applicable: inventarioAplicavelNaCompetencia(context.config, context.competence),
    inventory: context.inventory,
    items: context.inventoryItems,
    competenceEnd: context.end,
  });
  await options.progress?.("CALCULANDO_APURACAO");
  const assessment = projectSpedAssessment({
    competence: context.competence,
    documents: projection.documents,
    priorEfd: context.priorEfd,
    adjustments: context.adjustments,
  });
  await options.progress?.("MONTANDO_REGISTROS");
  const derivedUnits = deriveUnitConversions({
    usages: entryUnitUsages(projection.documents),
    manual: context.unitConversions,
    competenceStart: context.start,
  });
  const projectedCatalog = projectSpedCatalog({
    baseCatalogRecords: [...projection.catalogRecords, ...inventory.catalogRecords],
    unitConversions: [...context.unitConversions, ...derivedUnits.conversions],
    itemCorrelations: context.itemCorrelations,
    competenceStart: context.start,
    competenceEnd: context.end,
  });
  const catalog = { ...projectedCatalog, diagnostics: [...projectedCatalog.diagnostics, ...derivedUnits.diagnostics] };
  const records = context.company ? buildFoundationRecords({
    competence: context.competence,
    layoutCode: options.layout.code,
    finalidade: options.finalidade,
    company: context.company,
    config: context.config,
    accountant: context.accountant,
    payments1601: context.payments1601,
    catalogRecords: catalog.catalogRecords,
    blockCRecords: projection.blockCRecords,
    blockERecords: assessment.blockERecords,
    blockHRecords: inventory.records,
  }) : [];
  return { projection, inventory, assessment, catalog, records };
}

/** Itens de entrada de terceiro (os que têm C170), com as duas unidades e as duas quantidades. */
function entryUnitUsages(documents: ProjectedFiscalDocument[]): SpedEntryUnitUsage[] {
  return documents
    .filter((document) => !(document.ownIssued ?? document.sourceTable === "nfe") && !["02", "04"].includes(document.situationCode))
    .flatMap((document) => document.items.map((item) => ({
      code: item.code,
      documentUnit: item.documentUnit,
      inventoryUnit: item.inventoryUnit,
      documentQuantity: Number(item.payload?.quantidade) || 0,
      stockQuantity: item.payload?.assignment?.stockQuantity ?? null,
      source: item.sourceRefs[0],
    })));
}

async function loadAllItemConfigs(companyId: number): Promise<SpedExistingItemConfig[]> {
  const { rows } = await fetchAllPages<Row>("configurações de item (todas as vigências)", ({ from, to }) => supabaseAdmin
    .from("fiscal_sped_item_config").select("id, produto_id, codigo_item, tipo_item, vigencia_inicio, vigencia_fim", { count: "exact" })
    .eq("empresa_id", companyId).order("id").range(from, to));
  return rows.map((row) => ({
    id: number(row.id),
    productId: number(row.produto_id) || null,
    code: text(row.codigo_item),
    itemType: text(row.tipo_item),
    start: text(row.vigencia_inicio).slice(0, 10),
    end: row.vigencia_fim ? text(row.vigencia_fim).slice(0, 10) : null,
  }));
}

function autoProducts(context: SpedSourceContext): Map<number, SpedAutoProduct> {
  return new Map(Array.from(context.productsById.entries()).map(([id, row]) => {
    const master = productMaster(row);
    return [id, {
      id,
      description: master?.description ?? null,
      unit: master?.unit ?? null,
      ncm: master?.ncm ?? null,
      cest: master?.cest ?? null,
      barcode: master?.barcode ?? null,
      internalIcmsRate: master?.internalIcmsRate ?? null,
      deleted: row.is_deleted === true,
    }];
  }));
}

function productUsages(documents: ProjectedFiscalDocument[]): SpedProductUsage[] {
  return documents
    .filter((document) => !["02", "04"].includes(document.situationCode))
    .flatMap((document) => document.items
      .filter((item) => item.productId)
      .map((item) => ({
        productId: number(item.productId),
        operation: document.operation,
        ownIssued: document.ownIssued ?? document.sourceTable === "nfe",
        cfop: text(item.payload?.cfop),
        documentKey: document.key,
        itemNumber: item.number,
      })));
}

function xmlItemNumber(xml: string, itemNumber: number, tag: string): number {
  const det = new RegExp(`<(?:\\w+:)?det\\b[^>]*nItem="${itemNumber}"[^>]*>([\\s\\S]*?)</(?:\\w+:)?det>`, "i").exec(xml)?.[1] ?? "";
  const raw = new RegExp(`<(?:\\w+:)?${tag}>\\s*([^<]+?)\\s*</(?:\\w+:)?${tag}>`, "i").exec(det)?.[1];
  const parsed = Number(String(raw ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function creditCandidates(context: SpedSourceContext, documents: ProjectedFiscalDocument[]): SpedCreditCandidate[] {
  const xmlByEntry = new Map(context.entryRows.map((row) => [entryDocumentKey(row.source_table, row.id), documentXml(row)]));
  return documents
    .filter((document) => !(document.ownIssued ?? document.sourceTable === "nfe") && document.situationCode === "00")
    .flatMap((document) => {
      const dfeId = number(document.payload.fiscalDfeDocumentoId);
      if (!dfeId) return [];
      const xml = xmlByEntry.get(entryDocumentKey(document.sourceTable, document.sourceId)) ?? "";
      return document.items
        .filter((item) => item.creditTreatment === "PENDENTE")
        .map((item) => {
          const origin = text(item.payload?.origem);
          const cst = text(item.payload?.cst_icms);
          return {
            dfeId,
            itemNumber: item.number,
            documentKey: document.key,
            itemType: text(item.payload?.assignment?.itemType) || null,
            xmlIcms: Number(item.payload?.valor_icms) || 0,
            xmlSimplesCredit: xmlItemNumber(xml, item.number, "vCredICMSSN"),
            cst: origin && cst ? `${origin}${cst}` : null,
          };
        });
    });
}

/** Pendências de cadastro por produto (uma por produto, não uma por nota). */
const PLAN_DIAGNOSTIC_CODES = new Set([
  "TIPO_ITEM_NAO_DERIVAVEL",
  "CODIGO_ITEM_COMPARTILHADO",
  "CONFIG_ITEM_ENCERRADA",
  "PRODUTO_DOCUMENTO_INEXISTENTE",
  "CODIGO_ITEM_INDISPONIVEL",
  "POLITICA_CREDITO_REVENDA_PENDENTE",
]);

async function resolutionDiagnostics(context: SpedSourceContext, documents: ProjectedFiscalDocument[]): Promise<SpedDiagnostic[]> {
  const itemPlan = planSpedItemResolution({
    competenceStart: context.start,
    competenceEnd: context.end,
    products: autoProducts(context),
    usages: productUsages(documents),
    configs: await loadAllItemConfigs(context.companyId),
  });
  const creditPlan = planSpedCreditResolution({
    candidates: creditCandidates(context, documents),
    policy: readSpedPolicies(context.config),
  });
  return [...itemPlan.diagnostics, ...creditPlan.diagnostics].filter((diagnostic) => PLAN_DIAGNOSTIC_CODES.has(diagnostic.code));
}

export type SpedAutomaticResolutionResult = {
  itensCriados: number;
  itensIgnorados: number;
  creditosCriados: number;
  creditosIgnorados: number;
  pendencias: number;
};

/**
 * Aplica o que o ERP resolve sozinho: configuração 0200 dos produtos
 * movimentados e decisões de crédito determinísticas. Tudo numa transação que
 * revalida contra o banco; o que depende de decisão fiscal vira pendência.
 */
export async function resolveSpedCompetenceAutomatically(
  id: string,
  actorId: string,
  options: { progress?: SpedProgress } = {},
): Promise<SpedAutomaticResolutionResult> {
  const competence = await getCompetence(id);
  if (competence.status === "FECHADA") {
    return { itensCriados: 0, itensIgnorados: 0, creditosCriados: 0, creditosIgnorados: 0, pendencias: 0 };
  }
  let context = await collectSpedSources(competence);
  await options.progress?.("RESOLVENDO_CADASTROS");
  let documents = projectDocuments(context).documents;
  const itemPlan = planSpedItemResolution({
    competenceStart: context.start,
    competenceEnd: context.end,
    products: autoProducts(context),
    usages: productUsages(documents),
    configs: await loadAllItemConfigs(context.companyId),
  });
  const totals = { itensCriados: 0, itensIgnorados: 0, creditosCriados: 0, creditosIgnorados: 0 };
  const apply = async (items: Row[], credits: Row[]) => {
    if (!items.length && !credits.length) return;
    const result = await supabaseAdmin.rpc("fiscal_sped_aplicar_resolucao_automatica", {
      p_competencia_id: number(competence.id),
      p_itens: items,
      p_creditos: credits,
      p_usuario_id: actorId,
    });
    throwIfSupabaseError(result.error);
    const data = (result.data ?? {}) as Row;
    totals.itensCriados += number(data.itensCriados);
    totals.itensIgnorados += number(data.itensIgnorados);
    totals.creditosCriados += number(data.creditosCriados);
    totals.creditosIgnorados += number(data.creditosIgnorados);
  };
  await apply(itemPlan.create.map((item) => ({
    produto_id: item.productId,
    codigo_item: item.code,
    tipo_item: item.itemType,
    vigencia_inicio: item.start,
    vigencia_fim: item.end,
    evidencia: item.evidence,
  })), []);
  if (totals.itensCriados > 0) {
    // O tipo do item recém-configurado define a destinação usada no crédito.
    context = await collectSpedSources(competence);
    documents = projectDocuments(context).documents;
  }
  const creditPlan = planSpedCreditResolution({
    candidates: creditCandidates(context, documents),
    policy: readSpedPolicies(context.config),
  });
  await apply([], creditPlan.create.map((decision) => ({
    documento_id: decision.dfeId,
    numero_item: decision.itemNumber,
    tratamento_credito: decision.treatment,
    evidencia: decision.evidence,
  })));
  return { ...totals, pendencias: itemPlan.diagnostics.length + creditPlan.diagnostics.length };
}

export async function validateSpedCompetence(
  id: string,
  expectedVersion: unknown,
  actorId: string,
  options: { progress?: SpedProgress } = {},
) {
  const result = await runSpedValidation(id, expectedVersion, actorId, options);
  return { ...result, data: await getSpedCompetenceDetail(id) };
}

/** Validação sem montar o detalhe completo (documentos e itens) na resposta. */
export async function runSpedValidation(
  id: string,
  expectedVersion: unknown,
  actorId: string,
  options: { progress?: SpedProgress } = {},
) {
  const competence = await getCompetence(id);
  let version = await getVersion(competence.versao_atual_id);
  assertExpectedVersion(version, expectedVersion);
  if (version && !["RASCUNHO", "VALIDADA"].includes(text(version.status))) {
    throw new SpedServiceError("A competência está fechada. Reabra para validar novamente.", 409, "COMPETENCE_CLOSED");
  }
  const competenceText = month(competence.competencia);
  const layout = layoutFor(competenceText, version ? text(version.leiaute) : null);
  await options.progress?.("COLETANDO_DOCUMENTOS");
  const context = await collectSpedSources(competence);
  const finalidade = version?.finalidade === "RETIFICADORA" ? "RETIFICADORA" : "ORIGINAL";
  const built = await buildCompetenceProjection(context, { layout, finalidade, progress: options.progress });
  const { projection, inventory, assessment, catalog, records } = built;
  const hash = contextHash(context, records, projection.documents);
  if (!version) version = await openVersion(competence, actorId, hash, layout);
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
    await storeDocumentSnapshots(version, projection.documents, records, assessment, {
      itemsWith0220: catalog.itemsWith0220,
      itemsWith0221: catalog.itemsWith0221,
    });
    await storeRecords(version, records);
    const updated = await supabaseAdmin.from("fiscal_sped_versao").update({ context_hash: hash, source_cutoff_at: new Date().toISOString() }).eq("id", version.id).eq("status", "RASCUNHO");
    throwIfSupabaseError(updated.error);
  } else if (version.context_hash !== hash) {
    throw new SpedServiceError("As fontes mudaram após a validação. Reabra a versão antes de validar novamente.", 409, "SOURCE_CHANGED");
  }
  await options.progress?.("VALIDANDO");
  const candidate = {
    competence: context.competence,
    timezoneIana: text(context.config?.timezone_iana),
    gates: buildGateConfiguration(context.config, context.competence),
    conditionalEvidence: detectC176C179Evidence(context.noteRows.map((row) => ({
      key: documentKey(row),
      xml: documentXml(row),
      ownIssued: true,
      status: text(row.status),
    }))),
    records,
  };
  const diagnostics = [
    ...sourceDiagnostics(context, [
      ...projection.diagnostics,
      ...catalog.diagnostics,
      ...assessment.diagnostics,
      ...inventory.diagnostics,
      ...await resolutionDiagnostics(context, projection.documents),
    ]),
    ...validateSpedCandidate(candidate, layout),
  ];
  const begin = await supabaseAdmin.rpc("fiscal_sped_iniciar_validacao", { p_versao_id: version.id, p_context_hash: hash, p_usuario_id: actorId });
  throwIfSupabaseError(begin.error);
  await replaceDiagnostics(number(begin.data), diagnostics);
  const concluded = await supabaseAdmin.rpc("fiscal_sped_concluir_validacao", { p_execucao_id: begin.data, p_usuario_id: actorId });
  throwIfSupabaseError(concluded.error);
  return {
    validation: concluded.data,
    blocked: hasBlockingDiagnostics(diagnostics),
    reconciliation: projection.reconciliation,
    collection: context.collection as SpedCollectionReport[],
    recordCount: records.length,
  };
}

/** Fecha a versão que acabou de ser validada, sem repetir a projeção. */
export async function closeValidatedSpedCompetence(id: string, actorId: string) {
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
}

/** Estado mínimo da competência, sem montar o detalhe completo. */
export async function getSpedCompetenceState(id: string): Promise<{ id: string; status: string; versionNumber: number | null; empresaId: number }> {
  const competence = await getCompetence(id);
  const version = await getVersion(competence.versao_atual_id);
  return {
    id: String(competence.id),
    status: text(competence.status),
    versionNumber: version ? number(version.numero) : null,
    empresaId: number(competence.empresa_id),
  };
}

export async function closeSpedCompetence(id: string, expectedVersion: unknown, actorId: string) {
  await validateSpedCompetence(id, expectedVersion, actorId);
  await closeValidatedSpedCompetence(id, actorId);
  return getSpedCompetenceDetail(id);
}

export async function reopenSpedCompetence(id: string, expectedVersion: unknown, actorId: string, reason: unknown) {
  const competence = await getCompetence(id);
  const version = await getVersion(competence.versao_atual_id);
  assertExpectedVersion(version, expectedVersion);
  const reasonText = text(reason);
  if (!reasonText) throw new SpedServiceError("Motivo da reabertura é obrigatório.", 400, "REASON_REQUIRED");
  // A retificadora usa o leiaute vigente na competência, o mesmo da original.
  const layout = layoutFor(month(competence.competencia), version ? text(version.leiaute) : null);
  const context = await collectSpedSources(competence);
  const { projection, assessment, catalog, records } = await buildCompetenceProjection(context, { layout, finalidade: "RETIFICADORA" });
  const hash = contextHash(context, records, projection.documents);
  const result = await supabaseAdmin.rpc("fiscal_sped_reabrir_competencia", {
    p_competencia_id: competence.id,
    p_expected_lock_version: competence.lock_version,
    p_usuario_id: actorId,
    p_motivo: reasonText,
    p_leiaute: layout.code,
    p_guia_pratico: PRACTICAL_GUIDE,
    p_motor_versao: ENGINE_VERSION,
    p_git_commit: gitCommit(),
    p_source_cutoff_at: new Date().toISOString(),
    p_context_hash: hash,
  });
  throwIfSupabaseError(result.error);
  const newVersion = await getVersion(result.data);
  if (newVersion) {
    await storeDocumentSnapshots(newVersion, projection.documents, records, assessment, {
      itemsWith0220: catalog.itemsWith0220,
      itemsWith0221: catalog.itemsWith0221,
    });
    await storeRecords(newVersion, records);
  }
  return getSpedCompetenceDetail(id);
}

export type SpedGeneratedFile = {
  id: string;
  tipo: "PREVIA" | "FINAL";
  sha256: string;
  lineCount: number;
  sizeBytes: number;
  recordCounts: Record<string, number>;
  layout: string;
  versao: number;
  created: boolean;
};

export async function generateSpedFileRecord(
  id: string,
  expectedVersion: unknown,
  actorId: string,
  options?: { tipo?: "PREVIA" | "FINAL" },
): Promise<SpedGeneratedFile> {
  const competence = await getCompetence(id);
  const version = await getVersion(competence.versao_atual_id);
  assertExpectedVersion(version, expectedVersion);
  const { tipo } = validateSpedFileGenerationPreconditions({
    tipo: options?.tipo,
    competenceStatus: competence.status,
    versionStatus: version?.status,
    hasVersion: Boolean(version),
  });
  if (!version) {
    throw new SpedServiceError("Versão SPED não encontrada.", 404, "VERSION_NOT_FOUND");
  }
  const storedRecords = await readStoredRecords(number(version.id));
  if (storedRecords.length === 0) throw new SpedServiceError("Snapshots da versão não contêm registros EFD.", 422, "SNAPSHOT_EMPTY");
  // Só a prévia leva contador de marcação; o FINAL sem contador nem chega aqui (fechamento bloqueado).
  const records = tipo === "PREVIA" ? withPreviewAccountantPlaceholder(storedRecords) : storedRecords;
  const layout = layoutFor(month(competence.competencia), text(version.leiaute));
  const serialized = serializeEfd(records, layout);
  const hash = sha256Hex(serialized.bytes);
  const result: SpedGeneratedFile = {
    id: "",
    tipo,
    sha256: hash,
    lineCount: serialized.lineCount,
    sizeBytes: serialized.bytes.byteLength,
    recordCounts: serialized.recordCounts,
    layout: layout.code,
    versao: number(version.numero),
    created: false,
  };
  const findExisting = async () => {
    const existing = await supabaseAdmin
      .from("fiscal_sped_arquivo")
      .select("id")
      .eq("versao_id", version.id)
      .eq("tipo", tipo)
      .eq("arquivo_sha256", hash)
      .maybeSingle();
    throwIfSupabaseError(existing.error);
    return existing.data ? String(existing.data.id) : null;
  };
  const existingId = await findExisting();
  if (existingId) return { ...result, id: existingId };

  const path = buildSpedStoragePath(competence.empresa_id, month(competence.competencia), version.numero, tipo, hash);
  const upload = await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(path, serialized.bytes, { contentType: "text/plain", upsert: true });
  if (upload.error) {
    throw new SpedServiceError(`Falha no upload para o Storage: ${upload.error.message}`, 500, "STORAGE_UPLOAD_ERROR");
  }
  try {
    const registerRpc = await supabaseAdmin.rpc("fiscal_sped_registrar_arquivo", {
      p_versao_id: number(version.id),
      p_tipo: tipo,
      p_finalidade: version.finalidade,
      p_storage_bucket: STORAGE_BUCKET,
      p_storage_path: path,
      p_arquivo_sha256: hash,
      p_tamanho_bytes: serialized.bytes.byteLength,
      p_quantidade_registros: serialized.lineCount,
      p_contadores_registro: serialized.recordCounts,
      p_generated_by: actorId,
    });
    if (registerRpc.error) {
      const classification = classifySpedDbInsertError(registerRpc.error);
      if (!classification.isHashDuplicate) {
        await compensateStorage(path);
        throwIfSupabaseError(registerRpc.error);
      }
    }
    const registered = (Array.isArray(registerRpc.data) ? registerRpc.data[0] : registerRpc.data) as Row | null;
    const fileId = registered?.id ? String(registered.id) : await findExisting();
    if (!fileId) throw new SpedServiceError("O arquivo foi gerado, mas o registro não foi localizado.", 500, "FILE_NOT_REGISTERED");
    return { ...result, id: fileId, created: registered?.is_new !== false };
  } catch (err) {
    await compensateStorage(path);
    throw err;
  }
}

export async function generateSpedFile(
  id: string,
  expectedVersion: unknown,
  actorId: string,
  options?: { tipo?: "PREVIA" | "FINAL" },
) {
  await generateSpedFileRecord(id, expectedVersion, actorId, options);
  return getSpedCompetenceDetail(id);
}

async function compensateStorage(path: string) {
  try {
    const checkExisting = await supabaseAdmin
      .from("fiscal_sped_arquivo")
      .select("id")
      .eq("storage_path", path)
      .maybeSingle();
    if (!checkExisting.data) {
      await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([path]);
    }
  } catch {
    // Ignora erro de compensação de storage
  }
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
    loadEffectiveConfig(number(competence.empresa_id), `${month(competence.competencia)}-01`), latestExecution(number(competence.id)),
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

/** Lê todas as páginas e devolve no formato de resposta do Supabase. */
async function allRows(label: string, page: (range: { from: number; to: number }) => PromiseLike<{ data: Row[] | null; error: { message?: string; code?: string } | null; count?: number | null }>) {
  const { rows } = await fetchAllPages<Row>(label, page);
  return { data: rows, error: null };
}

/**
 * Detalhe da competência. Sem `includeSnapshots`, pula documentos e cadastros
 * (o volume grande) e serve ao acompanhamento da geração.
 */
export async function getSpedCompetenceDetail(id: string, options: { includeSnapshots?: boolean } = {}): Promise<SpedCompetenciaDetail> {
  const includeSnapshots = options.includeSnapshots !== false;
  const competence = await getCompetence(id);
  const version = await getVersion(competence.versao_atual_id);
  const summary = await summaryFor(competence);
  // A tela mostra a configuração vigente na competência, não a mais recente.
  const config = await loadEffectiveConfig(number(competence.empresa_id), `${month(competence.competencia)}-01`);
  const selectedInventoryId = number(config?.inventario_fechamento_id);
  const [companyResult, previousEfdResult, documentsResult, cadastrosResult, apuracaoResult, importsResult, adjustmentsResult, inventoryResult, execution, filesResult, accountantsResult] = await Promise.all([
    supabaseAdmin.from("empresa").select("id, cnpj, razaosocial, nomefantasia, inscricaoestadual, uf, regimetributario, cnae").eq("id", competence.empresa_id).maybeSingle(),
    supabaseAdmin.from("fiscal_sped_efd_anterior_importacao").select("id, competencia_arquivo, nome_arquivo, arquivo_sha256, status, imported_at").eq("competencia_id", competence.id).order("imported_at", { ascending: false }).limit(1).maybeSingle(),
    version && includeSnapshots
      ? allRows("documentos da versão", ({ from, to }) => supabaseAdmin.from("fiscal_sped_documento_snapshot").select("*, itens:fiscal_sped_item_snapshot(*)", { count: "exact" }).eq("versao_id", version.id).order("data_emissao_civil").order("id").range(from, to))
      : Promise.resolve({ data: [], error: null }),
    version && includeSnapshots
      ? allRows("cadastros da versão", ({ from, to }) => supabaseAdmin.from("fiscal_sped_cadastro_snapshot").select("*", { count: "exact" }).eq("versao_id", version.id).in("tipo", ["PARTICIPANTE", "ITEM"]).order("id").range(from, to))
      : Promise.resolve({ data: [], error: null }),
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
  const payments = importIds.length
    ? await allRows("linhas do 1601", ({ from, to }) => supabaseAdmin.from("fiscal_sped_1601_linha").select("*", { count: "exact" }).in("importacao_id", importIds).order("id").range(from, to))
    : { data: [], error: null };
  throwIfSupabaseError(payments.error);
  const fileRows = (filesResult.data ?? []) as Row[];
  const fileIds = fileRows.map((row) => row.id).filter(Boolean);
  const pvaValidationsResult = fileIds.length
    ? await supabaseAdmin
        .from("fiscal_sped_arquivo_validacao_pva")
        .select("*")
        .in("arquivo_id", fileIds)
        .order("validated_at", { ascending: false })
    : { data: [], error: null };
  throwIfSupabaseError(pvaValidationsResult.error);
  const pvaValidationsByFile = new Map<number, Row[]>();
  for (const val of (pvaValidationsResult.data ?? []) as Row[]) {
    const fileId = number(val.arquivo_id);
    pvaValidationsByFile.set(fileId, [...(pvaValidationsByFile.get(fileId) ?? []), val]);
  }
  const inventoryItems = inventoryResult.data
    ? await allRows("itens do inventário", ({ from, to }) => supabaseAdmin.from("fiscal_inventario_item").select("id, valor_total", { count: "exact" }).eq("inventario_id", inventoryResult.data.id).order("id").range(from, to))
    : { data: [], error: null };
  throwIfSupabaseError(inventoryItems.error);
  // Uma competência com milhares de itens pendentes passa de 1000 inconsistências.
  const inconsistencies = execution
    ? await allRows("inconsistências", ({ from, to }) => supabaseAdmin.from("fiscal_sped_inconsistencia").select("*", { count: "exact" }).eq("execucao_id", execution.id).order("id").range(from, to))
    : { data: [], error: null };
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
      campos: config ?? {},
      empresa: { uf: text(company.uf) || null, regimeTributario: text(company.regimetributario) || null, cnae: text(company.cnae) || null },
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
    arquivos: fileRows.map((row) => {
      const fileValidations = pvaValidationsByFile.get(number(row.id)) ?? [];
      const latestValidation = fileValidations[0];
      return {
        id: String(row.id),
        nome: text(row.storage_path).split("/").pop() || `sped-${row.id}.txt`,
        sequencia: number(row.sequencia),
        tipo: row.tipo,
        finalidade: row.finalidade,
        versao: number(version?.numero),
        layout: text(version?.leiaute),
        quantidadeRegistros: number(row.quantidade_registros),
        tamanhoBytes: number(row.tamanho_bytes),
        sha256: row.arquivo_sha256,
        geradoEm: row.generated_at,
        geradoPor: row.generated_by,
        pvaStatus: (latestValidation?.status as SpedPvaStatus) ?? null,
        pvaValidacoes: fileValidations.map((v) => ({
          id: String(v.id),
          arquivoId: String(v.arquivo_id),
          pvaVersao: text(v.pva_versao),
          status: v.status as SpedPvaStatus,
          relatorioStoragePath: v.relatorio_storage_path ?? null,
          relatorioSha256: v.relatorio_sha256 ?? null,
          observacao: v.observacao ?? null,
          validatedBy: v.validated_by,
          validatedAt: v.validated_at,
        })),
      };
    }),
    contabilistas: ((accountantsResult.data ?? []) as Row[]).map(toSpedContabilista),
    auditoria: [], sourceCutoffAt: version?.source_cutoff_at ?? null, contextHash: version?.context_hash ?? null,
  };
}

export async function getSpedFileSignedUrl(fileId: string) {
  const result = await supabaseAdmin.from("fiscal_sped_arquivo").select("id, storage_bucket, storage_path").eq("id", assertId(fileId)).maybeSingle();
  throwIfSupabaseError(result.error);
  if (!result.data) throw new SpedServiceError("Arquivo SPED não encontrado.", 404, "NOT_FOUND");
  // `download` faz o Storage responder como anexo: sem ele, o navegador abre o TXT numa aba.
  const fileName = text(result.data.storage_path).split("/").pop() || `sped-${result.data.id}.txt`;
  const signed = await supabaseAdmin.storage.from(result.data.storage_bucket).createSignedUrl(result.data.storage_path, 60, { download: fileName });
  throwIfSupabaseError(signed.error);
  if (!signed.data?.signedUrl) {
    throw new SpedServiceError("Não foi possível assinar o download do arquivo SPED.", 500, "SIGNED_URL_ERROR");
  }
  return { url: signed.data.signedUrl, expiresIn: 60 };
}

function answerOrigin(value: unknown): "AUTOMATICA" | "RESPOSTA" | "CONTADOR" | null {
  const origin = text(value);
  return origin === "AUTOMATICA" || origin === "RESPOSTA" || origin === "CONTADOR" ? origin : null;
}

/** Campos que guardam a decisão de cada gate. */
const GATE_VALUE_FIELDS: Record<string, string[]> = {
  timezone: ["timezone_iana"],
  perfil: ["perfil_efd"],
  atividade: ["indicador_atividade"],
  "bloco-k": ["bloco_k_obrigatorio"],
  "1400": ["registro_1400_aplicavel"],
  "c176-c179": ["c176_c179_aplicavel"],
  "1601": ["registro_1601_aplicavel"],
  inventario: ["inventario_aplicavel", "inventario_fechamento_id"],
  ipi: ["contribuinte_ipi"],
  "efd-contribuicoes": ["entrega_efd_contribuicoes"],
};

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
  const vigenciaInicio = input.patch.vigenciaInicio == null || input.patch.vigenciaInicio === ""
    ? null
    : text(input.patch.vigenciaInicio);
  if (vigenciaInicio && !/^\d{4}-(0[1-9]|1[0-2])$/.test(vigenciaInicio)) {
    throw new SpedServiceError("Informe a vigência no formato AAAA-MM.", 400, "INVALID_VIGENCIA");
  }
  let policies: Row = {};
  try {
    policies = normalizePolicyPatch(input.patch.politicas, input.actorId);
  } catch (error) {
    throw new SpedServiceError(error instanceof Error ? error.message : "Política fiscal inválida.", 400, "INVALID_POLICY");
  }
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
  const baseEvidence: Row = { ...(current?.evidencias ?? {}) };
  for (const [field, gateId] of Object.entries(evidenceByStatusField)) {
    if (!(field in payload)) continue;
    const nextStatus = text(payload[field]);
    if (nextStatus === "PENDENTE") {
      delete baseEvidence[gateId];
      continue;
    }
    const supplied = suppliedEvidence[gateId];
    const descricao = typeof supplied === "string"
      ? supplied.trim()
      : text((supplied as Row | undefined)?.descricao);
    if (!descricao) {
      throw new SpedServiceError(`Informe a evidência fiscal do gate ${gateId}.`, 400, "GATE_EVIDENCE_REQUIRED");
    }
    const details = supplied && typeof supplied === "object" ? supplied as Row : {};
    // A tela técnica reenvia todos os gates: o que voltou igual mantém quem decidiu e quando.
    const previous = current?.evidencias?.[gateId] as Row | undefined;
    const unchanged = !answerOrigin(details.origem)
      && previous && typeof previous === "object"
      && text(previous.descricao) === descricao
      && text(current?.[field]) === nextStatus
      && GATE_VALUE_FIELDS[gateId].every((key) => !(key in payload) || current?.[key] === payload[key]);
    if (unchanged) continue;
    baseEvidence[gateId] = {
      descricao,
      status: nextStatus,
      // Sem origem informada, a decisão veio da tela técnica do contador.
      origem: answerOrigin(details.origem) ?? "CONTADOR",
      // O modo automático só vale para o inventário (fevereiro decidido na competência).
      ...(gateId === "inventario" && details.modo === "AUTOMATICO" ? { modo: "AUTOMATICO" } : {}),
      confirmadoEm: new Date().toISOString(),
      confirmadoPor: input.actorId,
    };
  }

  // Processa e valida decisões auditáveis dos indicadores complementares do Registro 1010
  const supplied1010 = (suppliedEvidence.indicadores_1010 ?? input.patch.indicadores_1010) as Record<string, unknown> | undefined;
  const mergedEvidence = supplied1010 && typeof supplied1010 === "object"
    ? mergeSped1010Evidence(baseEvidence, supplied1010, input.actorId)
    : baseEvidence;

  payload.evidencias = { ...mergedEvidence, ...policies };

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
  await recordConfigurationVigencia(input.companyId, result.data as Row, vigenciaInicio, input.actorId);
  return result.data;
}

const UNDEFINED_TABLE = /fiscal_sped_config_vigencia|42P01|PGRST205/;

/**
 * Mantém o histórico de vigências. Sem data, a alteração corrige a vigência
 * mais recente (configuração inicial, por exemplo, vale desde sempre). Com
 * data, abre uma vigência nova: competências anteriores continuam com a
 * configuração da época.
 */
async function recordConfigurationVigencia(companyId: number, config: Row, vigenciaInicio: string | null, actorId: string) {
  const latest = await supabaseAdmin
    .from("fiscal_sped_config_vigencia")
    .select("id, vigencia_inicio")
    .eq("empresa_id", companyId)
    .order("vigencia_inicio", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) {
    if (UNDEFINED_TABLE.test(`${latest.error.code ?? ""} ${latest.error.message ?? ""}`)) return;
    throwIfSupabaseError(latest.error);
  }
  const start = vigenciaInicio ? `${vigenciaInicio}-01` : null;
  const latestStart = latest.data ? text(latest.data.vigencia_inicio).slice(0, 10) : null;
  if (start && latestStart && start < latestStart) {
    throw new SpedServiceError(
      `Já existe configuração vigente a partir de ${latestStart.slice(0, 7)}. Uma nova vigência precisa começar nessa data ou depois.`,
      409,
      "VIGENCIA_RETROATIVA",
    );
  }
  if (latest.data && (!start || start === latestStart)) {
    const updated = await supabaseAdmin.from("fiscal_sped_config_vigencia")
      .update({ payload: config, updated_by: actorId })
      .eq("id", latest.data.id);
    throwIfSupabaseError(updated.error);
    return;
  }
  const inserted = await supabaseAdmin.from("fiscal_sped_config_vigencia").insert({
    empresa_id: companyId,
    vigencia_inicio: start ?? "2000-01-01",
    payload: config,
    created_by: actorId,
    updated_by: actorId,
  });
  throwIfSupabaseError(inserted.error);
}

/**
 * O que o ERP sabe da empresa para responder a configuração sozinho: cadastro
 * (UF, regime, CNAE), recebimentos no financeiro e NF-e de importação.
 */
export async function loadSpedCompanyFacts(companyId: number): Promise<{ company: Row | null; facts: SpedFatosEmpresa }> {
  const [companyResult, electronic, anyReceipt, imports] = await Promise.all([
    supabaseAdmin.from("empresa").select("id, uf, codigomunicipio, regimetributario, cnae").eq("id", companyId).maybeSingle(),
    supabaseAdmin.from("transacao").select("id").eq("tipo", "RECEITA").eq("is_deleted", false)
      .in("metodopagamento", ["PIX", "CREDITO", "DEBITO"]).limit(1),
    supabaseAdmin.from("transacao").select("id").eq("tipo", "RECEITA").eq("is_deleted", false).limit(1),
    supabaseAdmin.from("nfe_item").select("id").like("cfop", "3%").limit(1),
  ]);
  for (const result of [companyResult, electronic, anyReceipt, imports]) throwIfSupabaseError(result.error);
  const company = companyResult.data as Row | null;
  const hasReceipts = (anyReceipt.data ?? []).length > 0;
  return {
    company,
    facts: {
      uf: company ? text(company.uf) || null : null,
      regimeTributario: company ? text(company.regimetributario) || null : null,
      cnae: company ? text(company.cnae) || null : null,
      // Sem nenhum recebimento lançado, o financeiro não diz nada sobre cartão/PIX.
      recebeCartaoOuPix: (electronic.data ?? []).length > 0 ? true : hasReceipts ? false : null,
      importaDoExterior: (imports.data ?? []).length > 0,
    },
  };
}

/**
 * Responde sozinho o que a lei ou o cadastro já respondem: fuso, perfil,
 * atividade, regime e seus efeitos, indicadores do 1010 pela atividade e as
 * políticas de crédito. Só preenche o que está pendente; nunca troca uma
 * resposta já dada.
 */
export async function applySmartSpedConfiguration(companyId: number, actorId: string): Promise<{ applied: string[] }> {
  const [{ company, facts }, current] = await Promise.all([loadSpedCompanyFacts(companyId), getConfig(companyId)]);
  if (!company) return { applied: [] };
  const plan = planejarDeducao(current ?? {}, facts);
  const body = corpoDoPatch(plan.patch);
  const evidence = (body.evidencias ?? {}) as Row;
  const applied: string[] = [...plan.perguntas];
  if (gateStatus(current?.timezone_status) === "PENDENTE") {
    const derived = deriveTimezoneFromAddress(company.uf, company.codigomunicipio);
    if (derived) {
      body.timezone_iana = derived.timezone;
      body.timezone_status = "CONFIRMADO";
      evidence.timezone = { descricao: derived.evidence, origem: "AUTOMATICA" };
      applied.push("timezone");
    }
  }
  body.evidencias = evidence;
  if (!current || applied.length > 0) {
    await updateSpedConfiguration({ companyId, actorId, patch: body });
  }
  return { applied };
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

/** Uso do produto na empresa → tipo do item no 0200 (Guia Prático, campo TIPO_ITEM). */
export const SPED_PRODUCT_USES = {
  REVENDA: { itemType: "00", label: "revenda ou aplicação em serviço" },
  USO_CONSUMO: { itemType: "07", label: "uso e consumo da empresa" },
  ATIVO: { itemType: "08", label: "bem da empresa (ativo imobilizado)" },
  MATERIA_PRIMA: { itemType: "01", label: "matéria-prima para fabricação" },
  PRODUTO_ACABADO: { itemType: "04", label: "produto fabricado pela empresa" },
} as const;
export type SpedProductUse = keyof typeof SPED_PRODUCT_USES;

/**
 * Classifica o produto pelo uso que a empresa faz dele. O código fiscal é o
 * que o produto já tem ou o id do produto; o crédito das entradas é decidido
 * pela resolução automática na próxima geração, a partir do tipo e do regime.
 */
export async function classifySpedProduct(input: {
  competenceId: string | number;
  productId: unknown;
  use: unknown;
  actorId: string;
}) {
  const productId = number(input.productId);
  if (!Number.isSafeInteger(productId) || productId <= 0) {
    throw new SpedServiceError("Produto inválido.", 400, "INVALID_PRODUCT");
  }
  const use = SPED_PRODUCT_USES[text(input.use) as SpedProductUse];
  if (!use) throw new SpedServiceError("Escolha para que a empresa usa o produto.", 400, "INVALID_PRODUCT_USE");
  const competence = await getCompetence(input.competenceId);
  if (competence.status === "FECHADA") {
    throw new SpedServiceError("Competência fechada não aceita decisões fiscais.", 409, "COMPETENCE_CLOSED");
  }

  const [own, taken] = await Promise.all([
    supabaseAdmin.from("fiscal_sped_item_config").select("codigo_item")
      .eq("empresa_id", competence.empresa_id).eq("produto_id", productId)
      .order("vigencia_inicio", { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("fiscal_sped_item_config").select("codigo_item, produto_id")
      .eq("empresa_id", competence.empresa_id).in("codigo_item", [String(productId), `PROD${productId}`]),
  ]);
  throwIfSupabaseError(own.error);
  throwIfSupabaseError(taken.error);
  const takenByOthers = new Set(((taken.data ?? []) as Row[])
    .filter((row) => number(row.produto_id) !== productId)
    .map((row) => text(row.codigo_item)));
  const code = text(own.data?.codigo_item)
    || [String(productId), `PROD${productId}`].find((candidate) => !takenByOthers.has(candidate));
  if (!code) {
    throw new SpedServiceError(
      `Os códigos ${productId} e PROD${productId} já pertencem a outros produtos. Peça ao contador para definir o código nos ajustes técnicos.`,
      409,
      "CODIGO_ITEM_INDISPONIVEL",
    );
  }

  const result = await supabaseAdmin.rpc("fiscal_sped_configurar_item_competencia", {
    p_competencia_id: number(competence.id),
    p_produto_id: productId,
    p_codigo_item: code,
    p_tipo_item: use.itemType,
    p_documento_id: null,
    p_numero_item: null,
    p_tratamento_credito: null,
    p_evidencia: `Uso informado por quem opera o ERP: ${use.label}`,
    p_usuario_id: input.actorId,
  });
  throwIfSupabaseError(result.error);
  return { productId, code, itemType: use.itemType };
}

const ADJUSTMENT_NATURES: Record<string, Set<string>> = {
  E111: new Set(["DEBITO", "CREDITO", "ESTORNO_CREDITO", "ESTORNO_DEBITO", "DEDUCAO", "DEBITO_ESPECIAL"]),
  E112: new Set(["REFERENCIA"]),
  E113: new Set(["REFERENCIA"]),
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

export async function recordPvaValidation(input: {
  arquivoId: string | number;
  pvaVersao: string;
  status: SpedPvaStatus;
  observacao?: string | null;
  relatorioStoragePath?: string | null;
  relatorioSha256?: string | null;
  actorId: string;
}): Promise<SpedPvaValidacao> {
  const fileId = number(input.arquivoId);
  if (!fileId) throw new SpedServiceError("ID de arquivo inválido.", 400, "INVALID_FILE_ID");
  const pvaVersao = text(input.pvaVersao);
  if (!pvaVersao) throw new SpedServiceError("Versão do PVA é obrigatória.", 400, "PVA_VERSION_REQUIRED");
  if (!["APROVADO", "REJEITADO", "COM_AVISOS"].includes(input.status)) {
    throw new SpedServiceError("Status de validação PVA inválido.", 400, "INVALID_PVA_STATUS");
  }
  const actorId = text(input.actorId);
  if (!actorId) throw new SpedServiceError("Usuário validador é obrigatório.", 401, "UNAUTHENTICATED");

  const fileResult = await supabaseAdmin
    .from("fiscal_sped_arquivo")
    .select("id, versao_id, versao:fiscal_sped_versao(competencia_id)")
    .eq("id", fileId)
    .maybeSingle();
  throwIfSupabaseError(fileResult.error);
  if (!fileResult.data) throw new SpedServiceError("Arquivo SPED não encontrado.", 404, "NOT_FOUND");

  if (input.relatorioSha256 && !/^[a-f0-9]{64}$/i.test(input.relatorioSha256)) {
    throw new SpedServiceError("Hash SHA-256 do relatório inválido.", 400, "INVALID_REPORT_HASH");
  }

  const inserted = await supabaseAdmin
    .from("fiscal_sped_arquivo_validacao_pva")
    .insert({
      arquivo_id: fileId,
      pva_versao: pvaVersao,
      status: input.status,
      relatorio_storage_path: input.relatorioStoragePath ? text(input.relatorioStoragePath) : null,
      relatorio_sha256: input.relatorioSha256 ? text(input.relatorioSha256).toLowerCase() : null,
      observacao: input.observacao ? text(input.observacao) : null,
      validated_by: actorId,
    })
    .select("*")
    .single();
  throwIfSupabaseError(inserted.error);

  const row = inserted.data as Row;
  return {
    id: String(row.id),
    arquivoId: String(row.arquivo_id),
    pvaVersao: row.pva_versao,
    status: row.status as SpedPvaStatus,
    relatorioStoragePath: row.relatorio_storage_path ?? null,
    relatorioSha256: row.relatorio_sha256 ?? null,
    observacao: row.observacao ?? null,
    validatedBy: row.validated_by,
    validatedAt: row.validated_at,
  };
}

export async function getSpedPvaValidations(arquivoId: string | number): Promise<SpedPvaValidacao[]> {
  const fileId = number(arquivoId);
  if (!fileId) throw new SpedServiceError("ID de arquivo inválido.", 400, "INVALID_FILE_ID");
  const result = await supabaseAdmin
    .from("fiscal_sped_arquivo_validacao_pva")
    .select("*")
    .eq("arquivo_id", fileId)
    .order("validated_at", { ascending: false });
  throwIfSupabaseError(result.error);
  return ((result.data ?? []) as Row[]).map((row) => ({
    id: String(row.id),
    arquivoId: String(row.arquivo_id),
    pvaVersao: row.pva_versao,
    status: row.status as SpedPvaStatus,
    relatorioStoragePath: row.relatorio_storage_path ?? null,
    relatorioSha256: row.relatorio_sha256 ?? null,
    observacao: row.observacao ?? null,
    validatedBy: row.validated_by,
    validatedAt: row.validated_at,
  }));
}

