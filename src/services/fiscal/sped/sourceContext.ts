import "server-only";

import {
  endOfCompetence,
  isCivilDateInCompetence,
  parseCompetence,
  parseFiscalDate,
} from "@/lib/fiscal-date";
import { inventarioAplicavelNaCompetencia } from "@/lib/sped/configuracao-empresa";
import { balancesFromEfdRecords, previousCompetence, type EfdRecord, type SpedDiagnostic } from "@/lib/sped/efd-icms-ipi";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import type { SpedItemCorrelation, SpedUnitConversion } from "./catalogProjection";
import { effectiveSpedConfig, type SpedConfigVigencia } from "./configPolicies";
import type { SpedProductMaster } from "./documentProjection";
import {
  automaticEntryFiscalDate,
  isConfirmedFiscalDateInCompetence,
  isSpedFiscalEntryCandidate,
} from "./entryScope";
import { throwIfSupabaseError } from "./errors";
import { collect1601FromFinance } from "./electronicPaymentsSource";
import { civilDateInTimezone, isDfeCancelledOrDenied } from "./guards";
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

/** Tabela de cabeçalho da entrada: a do estoque de venda ou a dos estoques simples. */
export type SpedEntryTable = "entrada" | "usoconsumo_entrada";

/** Item fiscal da nota e o estoque em que entrou: produto (venda) ou item simples (uso e consumo/geral). */
export type SpedEntryStockItem = { itemNumber: number; productId: number | null; simpleItemId: number | null; quantity: number };

const SIMPLE_ENTRY_COLUMNS = "id, status, data_entrada_fiscal, documento_fiscal_recebido_id, chave_nfe, fiscal, origem, tipo";

/** Chave que identifica o documento de entrada entre as duas tabelas, cujos ids se repetem. */
export function entryDocumentKey(table: string, id: unknown): string {
  return `${table}:${number(id)}`;
}

function asStockEntryRow(row: Row): Row {
  return { ...row, source_table: "entrada" satisfies SpedEntryTable };
}

/** Entrada dos estoques simples no formato da `entrada`, para o mesmo recorte fiscal. */
function asSimpleEntryRow(row: Row): Row {
  return {
    ...row,
    source_table: "usoconsumo_entrada" satisfies SpedEntryTable,
    notachave: row.chave_nfe,
    fiscal_dfe_documento_id: row.documento_fiscal_recebido_id,
  };
}

function validKeys(values: unknown[]): string[] {
  return Array.from(new Set(values.map(text).filter((key) => /^\d{44}$/.test(key))));
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

const PRIOR_EFD_COLUMNS = "id, competencia_id, competencia_arquivo, arquivo_sha256, status, cabecalho, saldos_apuracao";

/**
 * Saldos do mês anterior, na ordem: EFD importada nesta competência; mês
 * anterior fechado no próprio ERP (o arquivo final que ele gerou); EFD do mês
 * anterior importada em outra competência da empresa. Só o primeiro mês no ERP
 * precisa importar a EFD entregue pelo sistema antigo.
 */
async function resolvePriorEfd(input: { competenceId: number; companyId: number; competenceText: string }): Promise<{ data: Row | null; error: any }> {
  const own = await supabaseAdmin.from("fiscal_sped_efd_anterior_importacao").select(PRIOR_EFD_COLUMNS)
    .eq("competencia_id", input.competenceId).eq("status", "VALIDADA").order("imported_at", { ascending: false }).limit(1).maybeSingle();
  if (own.error || own.data) return { data: own.data ? { ...own.data, origem: "IMPORTACAO" } : null, error: own.error };

  const previousStart = `${previousCompetence(input.competenceText)}-01`;
  const previous = await supabaseAdmin.from("fiscal_sped_competencia").select("id, status, versao_atual_id")
    .eq("empresa_id", input.companyId).eq("competencia", previousStart).maybeSingle();
  if (previous.error) return { data: null, error: previous.error };
  if (previous.data?.status === "FECHADA" && previous.data.versao_atual_id) {
    const stored = await supabaseAdmin.from("fiscal_sped_cadastro_snapshot").select("payload")
      .eq("versao_id", previous.data.versao_atual_id).eq("tipo", "CONFIG").eq("codigo", "EFD_RECORDS").maybeSingle();
    if (stored.error) return { data: null, error: stored.error };
    const records = (stored.data?.payload as Row | undefined)?.records;
    if (Array.isArray(records) && records.length) return {
      data: {
        id: `competencia:${previous.data.id}`,
        origem: "COMPETENCIA_FECHADA",
        competencia_id: previous.data.id,
        competencia_arquivo: previousStart,
        versao_id: previous.data.versao_atual_id,
        saldos_apuracao: balancesFromEfdRecords(records as EfdRecord[]),
      },
      error: null,
    };
  }

  const elsewhere = await supabaseAdmin.from("fiscal_sped_efd_anterior_importacao")
    .select(`${PRIOR_EFD_COLUMNS}, competencia:competencia_id!inner(empresa_id)`)
    .eq("competencia_arquivo", previousStart).eq("status", "VALIDADA").eq("competencia.empresa_id", input.companyId)
    .order("imported_at", { ascending: false }).limit(1).maybeSingle();
  if (elsewhere.error) return { data: null, error: elsewhere.error };
  if (!elsewhere.data) return { data: null, error: null };
  const { competencia: _competence, ...row } = elsewhere.data as Row;
  return { data: { ...row, origem: "IMPORTACAO_OUTRA_COMPETENCIA" }, error: null };
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
    resolvePriorEfd({ competenceId: number(competence.id), companyId, competenceText }),
    supabaseAdmin.from("fiscal_sped_1601_importacao").select("id, arquivo_sha256, imported_at").eq("competencia_id", competence.id).eq("status", "VALIDADA").order("imported_at", { ascending: false }),
  ]);
  throwIfSupabaseError(companyResult.error);
  throwIfSupabaseError(accountantResult.error);
  throwIfSupabaseError(priorEfdResult.error);
  throwIfSupabaseError(paymentImportsResult.error);

  // Janela de ±2 dias pela coluna timestamptz; o recorte fiscal usa a data civil lexical do XML.
  const [rawNotes, rawEntries, rawUndated, rawSimpleEntries, rawSimpleUndated, adjustments] = await Promise.all([
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
    // Sem data fiscal confirmada: entram pelo dia do lançamento. Janela de ±1 dia
    // pela coluna timestamptz; o recorte usa a data civil no fuso da empresa.
    fetchAllPages<Row>("entradas sem data fiscal", ({ from, to }) => supabaseAdmin
      .from("entrada")
      .select("id, status, fiscal, origem, tipo, notachave, fiscal_dfe_documento_id, created_at, data_emissao, data_entrada_fiscal, dfe:fiscal_dfe_documento_id(data_emissao)", { count: "exact" })
      .eq("status", "CONFIRMADA").is("data_entrada_fiscal", null)
      .gte("created_at", `${shiftCivilDate(start, -1)}T00:00:00`).lte("created_at", `${shiftCivilDate(end, 1)}T23:59:59.999`)
      .order("id").range(from, to)).then(track),
    // Notas que entraram nos estoques de uso e consumo ou geral. Nota mista tem
    // também uma `entrada`, que é o cabeçalho dela; separadas mais abaixo.
    fetchAllPages<Row>("entradas de uso e consumo e geral com data fiscal na competência", ({ from, to }) => supabaseAdmin
      .from("usoconsumo_entrada")
      .select(SIMPLE_ENTRY_COLUMNS, { count: "exact" })
      .eq("status", "CONFIRMADA").gte("data_entrada_fiscal", start).lte("data_entrada_fiscal", end)
      .order("id").range(from, to)).then(track),
    fetchAllPages<Row>("entradas de uso e consumo e geral sem data fiscal", ({ from, to }) => supabaseAdmin
      .from("usoconsumo_entrada")
      .select(`${SIMPLE_ENTRY_COLUMNS}, created_at, data_emissao, dfe:documento_fiscal_recebido_id(data_emissao)`, { count: "exact" })
      .eq("status", "CONFIRMADA").is("data_entrada_fiscal", null)
      .gte("created_at", `${shiftCivilDate(start, -1)}T00:00:00`).lte("created_at", `${shiftCivilDate(end, 1)}T23:59:59.999`)
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
  const timezone = text(config?.timezone_iana) || null;
  // Sem data confirmada à mão, a entrada vale pelo dia do lançamento no estoque
  // (nunca antes da emissão). Confirmação manual, quando existe, prevalece.
  const withAutomaticDate = (row: Row): Row => ({
    ...row,
    data_entrada_fiscal: automaticEntryFiscalDate(row, timezone),
    data_entrada_fiscal_automatica: true,
  });
  const inCompetence = (row: Row) => isSpedFiscalEntryCandidate(row) && isConfirmedFiscalDateInCompetence(row, { start, end });
  const stockEntryRows = [
    ...rawEntries.map(asStockEntryRow),
    ...rawUndated.map(asStockEntryRow).map(withAutomaticDate),
  ].filter(inCompetence);

  // Nota mista: a `entrada` é o cabeçalho e a `usoconsumo_entrada` da mesma
  // chave traz o resto dos itens. Só a nota que não tem `entrada` vira documento
  // pelo lado de uso e consumo/geral.
  const simpleKeys = validKeys([...rawSimpleEntries, ...rawSimpleUndated].map((row) => row.chave_nfe));
  const [mixedHeaders, mixedSimpleSides] = await Promise.all([
    fetchAllByIds<Row, string>("entradas das notas mistas", simpleKeys, (keys, { from, to }) => supabaseAdmin
      .from("entrada").select("id, notachave", { count: "exact" }).in("notachave", keys).eq("status", "CONFIRMADA")
      .order("id").range(from, to)).then(track),
    fetchAllByIds<Row, string>("uso e consumo/geral das notas mistas", validKeys(stockEntryRows.map((row) => row.notachave)), (keys, { from, to }) => supabaseAdmin
      .from("usoconsumo_entrada").select("id, chave_nfe", { count: "exact" }).in("chave_nfe", keys).eq("status", "CONFIRMADA")
      .order("id").range(from, to)).then(track),
  ]);
  const mixedKeys = new Set(mixedHeaders.map((row) => text(row.notachave)));
  const isSimpleOnly = (row: Row) => !mixedKeys.has(text(row.notachave));
  const simpleEntryRows = [
    ...rawSimpleEntries.map(asSimpleEntryRow),
    ...rawSimpleUndated.map(asSimpleEntryRow).map(withAutomaticDate),
  ].filter((row) => isSimpleOnly(row) && inCompetence(row));
  const entryRows = [...stockEntryRows, ...simpleEntryRows];

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
  const entryIds = stockEntryRows.map((row) => number(row.id)).filter(Boolean);
  const simpleEntryIds = Array.from(new Set([
    ...simpleEntryRows.map((row) => number(row.id)),
    ...mixedSimpleSides.map((row) => number(row.id)),
  ].filter(Boolean)));
  const [noteItems, entryItems, simpleEntryItems, itemConfigs, creditDecisions, unitConversionRows, itemCorrelationRows] = await Promise.all([
    fetchAllByIds<Row, number>("itens das NF-e emitidas", noteIds, (ids, { from, to }) => supabaseAdmin
      .from("nfe_item").select("id, nfe_id, n_item, produtoid", { count: "exact" }).in("nfe_id", ids).order("id").range(from, to)).then(track),
    fetchAllByIds<Row, number>("itens das entradas", entryIds, (ids, { from, to }) => supabaseAdmin
      .from("entradaitens").select("id, entrada_id, numero_item_fiscal, produto_id, quantidade", { count: "exact" }).in("entrada_id", ids)
      .not("numero_item_fiscal", "is", null).order("id").range(from, to)).then(track),
    fetchAllByIds<Row, number>("itens de uso e consumo e geral das entradas", simpleEntryIds, (ids, { from, to }) => supabaseAdmin
      .from("usoconsumo_entrada_item").select("id, entrada_id, numero_item_fiscal, item_id, quantidade", { count: "exact" }).in("entrada_id", ids)
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
        source: { source: "BANCO", table: row.source_table, id: row.id, documentKey: text(row.notachave) || undefined },
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
  // Em que estoque cada item fiscal da nota entrou, por documento (`tabela:id`).
  const entryStockItemsByDocument = new Map<string, SpedEntryStockItem[]>();
  const addStockItem = (documentKey: string, item: SpedEntryStockItem) => {
    if (item.itemNumber) entryStockItemsByDocument.set(documentKey, [...(entryStockItemsByDocument.get(documentKey) ?? []), item]);
  };
  for (const item of entryItems) {
    addStockItem(entryDocumentKey("entrada", item.entrada_id), { itemNumber: number(item.numero_item_fiscal), productId: number(item.produto_id) || null, simpleItemId: null, quantity: number(item.quantidade) });
  }
  const headerOfSimpleEntry = new Map<number, string>(simpleEntryRows.map((row) => [number(row.id), entryDocumentKey("usoconsumo_entrada", row.id)]));
  const entradaByKey = new Map(stockEntryRows.map((row) => [text(row.notachave), number(row.id)]));
  for (const row of mixedSimpleSides) {
    const entradaId = entradaByKey.get(text(row.chave_nfe));
    if (entradaId) headerOfSimpleEntry.set(number(row.id), entryDocumentKey("entrada", entradaId));
  }
  for (const item of simpleEntryItems) {
    const documentKey = headerOfSimpleEntry.get(number(item.entrada_id));
    if (documentKey) addStockItem(documentKey, { itemNumber: number(item.numero_item_fiscal), productId: null, simpleItemId: number(item.item_id) || null, quantity: number(item.quantidade) });
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
  const simpleItemIds = Array.from(new Set(simpleEntryItems.map((item) => number(item.item_id)).filter(Boolean)));
  const [productRows, simpleItemRows] = await Promise.all([
    fetchAllByIds<Row, number>("produtos movimentados", productIds, (ids, { from, to }) => supabaseAdmin
      .from("produto").select("id, titulo, descricao, unidade, ncm, cest, codigobarras, aliquotaicms, is_deleted", { count: "exact" })
      .in("id", ids).order("id").range(from, to)).then(track),
    fetchAllByIds<Row, number>("itens de uso e consumo e geral movimentados", simpleItemIds, (ids, { from, to }) => supabaseAdmin
      .from("usoconsumo_item").select("id, titulo, descricao, unidade, ncm, cest, codigobarras, aliquotaicms, escopo", { count: "exact" })
      .in("id", ids).order("id").range(from, to)).then(track),
  ]);
  const productsById = new Map<number, Row>(productRows.map((row) => [number(row.id), row]));
  const simpleItemsById = new Map<number, Row>(simpleItemRows.map((row) => [number(row.id), row]));

  const paymentImportIds = ((paymentImportsResult.data ?? []) as Row[]).map((row) => number(row.id)).filter(Boolean);
  const importedPayments1601 = track(await fetchAllByIds<Row, number>("linhas do 1601", paymentImportIds, (ids, { from, to }) => supabaseAdmin
    .from("fiscal_sped_1601_linha").select("*", { count: "exact" }).in("importacao_id", ids).order("id").range(from, to)))
    .sort((left, right) => number(left.importacao_id) - number(right.importacao_id) || number(left.numero_linha) - number(right.numero_linha));
  // Sem CSV importado, o 1601 sai do financeiro; o CSV, quando existe, prevalece.
  const finance1601 = !paymentImportIds.length && config?.registro_1601_aplicavel === true
    ? await collect1601FromFinance({ start, end, timezone: text(config?.timezone_iana) || null, track })
    : { rows: [], diagnostics: [] };
  const payments1601: Row[] = paymentImportIds.length ? importedPayments1601 : finance1601.rows;
  const chosenInventoryId = number(config?.inventario_fechamento_id);
  // Modo automático: o SPED de fevereiro leva o inventário aprovado de 31/12 do ano anterior.
  const automaticInventoryDate = !chosenInventoryId && inventarioAplicavelNaCompetencia(config, competenceText)
    ? `${Number(competenceText.slice(0, 4)) - 1}-12-31`
    : null;
  const inventoryResult = chosenInventoryId
    ? await supabaseAdmin.from("fiscal_inventario_fechamento").select("*").eq("id", chosenInventoryId).eq("empresa_id", companyId).eq("status", "APROVADO").maybeSingle()
    : automaticInventoryDate
      ? await supabaseAdmin.from("fiscal_inventario_fechamento").select("*").eq("empresa_id", companyId).eq("status", "APROVADO")
        .eq("data_inventario", automaticInventoryDate).order("approved_at", { ascending: false }).limit(1).maybeSingle()
      : { data: null, error: null };
  throwIfSupabaseError(inventoryResult.error);
  const inventoryId = inventoryResult.data ? number((inventoryResult.data as Row).id) : 0;
  const inventoryItems = inventoryResult.data
    ? track(await fetchAllPages<Row>("itens do inventário", ({ from, to }) => supabaseAdmin
      .from("fiscal_inventario_item").select("*, config:fiscal_sped_item_config(tipo_item)", { count: "exact" })
      .eq("inventario_id", inventoryId).order("id").range(from, to)))
      .sort((left, right) => text(left.codigo_item).localeCompare(text(right.codigo_item), "en") || number(left.id) - number(right.id))
    : [];

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
    entryStockItemsByDocument,
    itemConfigsByProduct,
    allItemConfigs: itemConfigs,
    creditDecisionsByItem,
    productsById,
    simpleItemsById,
    unitConversions,
    itemCorrelations,
    mappingDiagnostics: [...mappingDiagnostics, ...receivedWithoutEntry, ...finance1601.diagnostics],
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
    .from("fiscal_dfe_documento").select("id, chave_acesso, schema, status, status_manifestacao, data_emissao, emitente_nome", { count: "exact" })
    .eq("empresa_id", input.companyId)
    .gte("data_emissao", `${shiftCivilDate(input.start, -1)}T00:00:00`).lte("data_emissao", `${shiftCivilDate(input.end, 1)}T23:59:59.999`)
    .order("id").range(from, to)));
  const byKey = new Map<string, Row>();
  // Um registro cancelado (resumo novo ou evento) vale pela chave inteira. Nota
  // que a empresa manifestou como desconhecida ou não realizada não é compra.
  const notPurchase = (row: Row) => isDfeCancelledOrDenied(row)
    || ["DESCONHECIMENTO", "OPERACAO_NAO_REALIZADA"].includes(text(row.status_manifestacao).toUpperCase());
  const cancelledKeys = new Set(received.filter(notPurchase).map((row) => text(row.chave_acesso)));
  for (const row of received) {
    const key = text(row.chave_acesso);
    if (!/^\d{44}$/.test(key) || !/^(procNFe|resNFe)/i.test(text(row.schema)) || cancelledKeys.has(key)) continue;
    const civil = civilDateInTimezone(row.data_emissao, input.timezone) ?? text(row.data_emissao).slice(0, 10);
    if (civil.slice(0, 7) !== input.competenceText) continue;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  if (byKey.size === 0) return [];
  const keys = Array.from(byKey.keys());
  const receivedIds = received.map((row) => number(row.id));
  // A entrada pode ter ido para qualquer um dos três estoques.
  const [linked, linkedById, simpleLinked, simpleLinkedById] = await Promise.all([
    fetchAllByIds<Row, string>("entradas das NF-e recebidas", keys, (part, { from, to }) => supabaseAdmin
      .from("entrada").select("id, notachave", { count: "exact" }).in("notachave", part).order("id").range(from, to)).then(input.track),
    fetchAllByIds<Row, number>("entradas vinculadas ao DF-e", receivedIds, (part, { from, to }) => supabaseAdmin
      .from("entrada").select("id, fiscal_dfe_documento_id", { count: "exact" }).in("fiscal_dfe_documento_id", part).order("id").range(from, to)).then(input.track),
    fetchAllByIds<Row, string>("entradas de uso e consumo e geral das NF-e recebidas", keys, (part, { from, to }) => supabaseAdmin
      .from("usoconsumo_entrada").select("id, chave_nfe", { count: "exact" }).in("chave_nfe", part).order("id").range(from, to)).then(input.track),
    fetchAllByIds<Row, number>("entradas de uso e consumo e geral vinculadas ao DF-e", receivedIds, (part, { from, to }) => supabaseAdmin
      .from("usoconsumo_entrada").select("id, documento_fiscal_recebido_id", { count: "exact" }).in("documento_fiscal_recebido_id", part).order("id").range(from, to)).then(input.track),
  ]);
  const entered = new Set([...linked.map((row) => text(row.notachave)), ...simpleLinked.map((row) => text(row.chave_nfe))]);
  const enteredDfe = new Set([
    ...linkedById.map((row) => number(row.fiscal_dfe_documento_id)),
    ...simpleLinkedById.map((row) => number(row.documento_fiscal_recebido_id)),
  ]);
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
