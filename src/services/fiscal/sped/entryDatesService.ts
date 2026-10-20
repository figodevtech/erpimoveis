import "server-only";

import { isValidCivilDate } from "@/lib/fiscal-date";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { SpedServiceError, throwIfSupabaseError } from "./errors";
import { civilDateInTimezone, closedMonthsAffectedByDateChange } from "./guards";
import { automaticEntryFiscalDate, isSpedFiscalEntryCandidate } from "./entryScope";
import type { SpedEntradaDataFiscalPendente } from "./types";

type Row = Record<string, any>;

const MAX_BATCH = 500;

/**
 * Prefixo do id das entradas que foram só para uso e consumo ou geral. Os ids de
 * `entrada` e `usoconsumo_entrada` se repetem, e a tela trata o id como texto.
 */
const SIMPLE_PREFIX = "uc:";

type EntryTable = "entrada" | "usoconsumo_entrada";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function one(value: unknown): Row | null {
  return (Array.isArray(value) ? value[0] : value) as Row | null;
}

/** Entrada dos estoques simples no formato que o recorte fiscal da `entrada` entende. */
function asEntryCandidate(row: Row): Row {
  return { ...row, notachave: row.chave_nfe, fiscal_dfe_documento_id: row.documento_fiscal_recebido_id };
}

/** Chaves que têm `entrada` confirmada: a nota mista é confirmada por ela. */
async function keysWithStockEntry(keys: string[]): Promise<Set<string>> {
  const valid = keys.filter((key) => /^\d{44}$/.test(key));
  if (!valid.length) return new Set();
  const result = await supabaseAdmin.from("entrada").select("notachave").in("notachave", valid).eq("status", "CONFIRMADA");
  throwIfSupabaseError(result.error);
  return new Set(((result.data ?? []) as Row[]).map((row) => text(row.notachave)));
}

/** Entradas fiscais confirmadas, nos três estoques, que ainda não têm data de escrituração confirmada. */
export async function listPendingEntryFiscalDates(): Promise<SpedEntradaDataFiscalPendente[]> {
  const configResult = await supabaseAdmin.from("fiscal_sped_config").select("timezone_iana").order("empresa_id").limit(1).maybeSingle();
  throwIfSupabaseError(configResult.error);
  const timeZone = text(configResult.data?.timezone_iana) || null;
  const [stockResult, simpleResult] = await Promise.all([
    supabaseAdmin
      .from("entrada")
      .select(`
        id, created_at, data_emissao, numero_nota, serie_nota, notachave, valor_total,
        data_entrada_fiscal_sugerida, fiscal, origem, tipo, fiscal_dfe_documento_id,
        fornecedor:fornecedorid(nomerazaosocial, nomefantasia, cpfcnpj),
        dfe:fiscal_dfe_documento_id(data_emissao)
      `)
      .eq("fiscal", true)
      .eq("status", "CONFIRMADA")
      .is("data_entrada_fiscal", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(MAX_BATCH),
    supabaseAdmin
      .from("usoconsumo_entrada")
      .select(`
        id, created_at, data_emissao, numero_nota, serie_nota, chave_nfe, valor_total,
        fiscal, origem, tipo, documento_fiscal_recebido_id,
        fornecedor:fornecedor_id(nomerazaosocial, nomefantasia, cpfcnpj),
        dfe:documento_fiscal_recebido_id(data_emissao)
      `)
      .eq("fiscal", true)
      .eq("status", "CONFIRMADA")
      .is("data_entrada_fiscal", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(MAX_BATCH),
  ]);
  throwIfSupabaseError(stockResult.error);
  throwIfSupabaseError(simpleResult.error);

  const simpleRows = ((simpleResult.data ?? []) as Row[]).map(asEntryCandidate);
  const mixed = await keysWithStockEntry(simpleRows.map((row) => text(row.notachave)));
  const candidates = [
    ...((stockResult.data ?? []) as Row[]).map((row) => ({ row, id: String(row.id) })),
    ...simpleRows.filter((row) => !mixed.has(text(row.notachave))).map((row) => ({ row, id: `${SIMPLE_PREFIX}${row.id}` })),
  ]
    .filter(({ row }) => isSpedFiscalEntryCandidate(row))
    .sort((left, right) => text(left.row.created_at).localeCompare(text(right.row.created_at)) || left.id.localeCompare(right.id))
    .slice(0, MAX_BATCH);

  return candidates.map(({ row, id }) => {
    const fornecedor = one(row.fornecedor);
    const dfe = one(row.dfe);
    return {
      id,
      numeroNota: text(row.numero_nota) || null,
      serieNota: text(row.serie_nota) || null,
      chave: text(row.notachave) || null,
      fornecedor: text(fornecedor?.nomerazaosocial || fornecedor?.nomefantasia) || null,
      documentoFornecedor: text(fornecedor?.cpfcnpj) || null,
      valorTotal: Number(row.valor_total ?? 0) || 0,
      // Datas civis: o texto do documento, sem conversão de fuso.
      dataEmissao: text(dfe?.data_emissao || row.data_emissao).slice(0, 10) || null,
      dataLancamento: text(row.created_at) || null,
      dataLancamentoCivil: civilDateInTimezone(row.created_at, timeZone),
      // Sem sugestão gravada, a mesma data que o SPED usa sozinho: o lançamento.
      dataSugerida: text(row.data_entrada_fiscal_sugerida).slice(0, 10) || automaticEntryFiscalDate(row, timeZone),
    };
  });
}

function parseEntryId(raw: unknown): { table: EntryTable; id: number } | null {
  const value = text(raw);
  const simple = value.startsWith(SIMPLE_PREFIX);
  const id = Number(simple ? value.slice(SIMPLE_PREFIX.length) : value);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { table: simple ? "usoconsumo_entrada" : "entrada", id };
}

const CURRENT_COLUMNS: Record<EntryTable, string> = {
  entrada: "id, data_entrada_fiscal, fiscal, origem, tipo, notachave, fiscal_dfe_documento_id",
  usoconsumo_entrada: "id, data_entrada_fiscal, fiscal, origem, tipo, chave_nfe, documento_fiscal_recebido_id",
};

export async function confirmEntryFiscalDates(input: {
  items: unknown;
  actorId: string;
}): Promise<{ atualizadas: number }> {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new SpedServiceError("Informe ao menos uma entrada.", 400, "ITEMS_REQUIRED");
  }
  if (input.items.length > MAX_BATCH) {
    throw new SpedServiceError(`Confirme no máximo ${MAX_BATCH} entradas por vez.`, 400, "BATCH_TOO_LARGE");
  }

  const dateByEntry = new Map<string, { table: EntryTable; id: number; date: string }>();
  for (const raw of input.items as Row[]) {
    const entry = parseEntryId(raw?.id);
    const date = text(raw?.dataEntradaFiscal);
    if (!entry) throw new SpedServiceError("Entrada inválida.", 400, "INVALID_ID");
    const label = text(raw?.id);
    if (!isValidCivilDate(date)) throw new SpedServiceError(`Data fiscal inválida na entrada ${label}.`, 400, "INVALID_DATE");
    const key = `${entry.table}:${entry.id}`;
    if (dateByEntry.has(key) && dateByEntry.get(key)!.date !== date) {
      throw new SpedServiceError(`A entrada ${label} veio com duas datas diferentes.`, 400, "DUPLICATE_ENTRY");
    }
    dateByEntry.set(key, { ...entry, date });
  }

  const idsOf = (table: EntryTable) => Array.from(dateByEntry.values()).filter((entry) => entry.table === table).map((entry) => entry.id);
  const fetchCurrent = async (table: EntryTable) => {
    const ids = idsOf(table);
    if (!ids.length) return [] as Row[];
    const result = await supabaseAdmin.from(table).select(CURRENT_COLUMNS[table]).in("id", ids).eq("status", "CONFIRMADA");
    throwIfSupabaseError(result.error);
    const rows = (result.data ?? []) as unknown as Row[];
    return table === "entrada" ? rows : rows.map(asEntryCandidate);
  };
  const [stockRows, simpleRows, closedResult] = await Promise.all([
    fetchCurrent("entrada"),
    fetchCurrent("usoconsumo_entrada"),
    supabaseAdmin.from("fiscal_sped_competencia").select("competencia").eq("status", "FECHADA"),
  ]);
  throwIfSupabaseError(closedResult.error);

  const currentByKey = new Map<string, string | null>();
  for (const [table, rows] of [["entrada", stockRows], ["usoconsumo_entrada", simpleRows]] as const) {
    for (const row of rows.filter(isSpedFiscalEntryCandidate)) currentByKey.set(`${table}:${row.id}`, row.data_entrada_fiscal as string | null);
  }
  const missing = Array.from(dateByEntry.entries()).filter(([key]) => !currentByKey.has(key)).map(([, entry]) => entry);
  if (missing.length) {
    const labels = missing.map((entry) => (entry.table === "entrada" ? String(entry.id) : `${SIMPLE_PREFIX}${entry.id}`));
    throw new SpedServiceError(`Entradas fiscais documentais confirmadas não encontradas: ${labels.join(", ")}.`, 404, "ENTRY_NOT_FOUND");
  }

  const closedMonths = new Set(((closedResult.data ?? []) as Row[]).map((row) => text(row.competencia).slice(0, 7)));
  const blocked: string[] = [];
  const idsByTableAndDate = new Map<string, { table: EntryTable; date: string; ids: number[] }>();
  for (const [key, entry] of dateByEntry) {
    const current = currentByKey.get(key);
    const months = closedMonthsAffectedByDateChange(current, entry.date, closedMonths);
    if (months.length) blocked.push(`entrada ${entry.id} (${months.join(", ")})`);
    if (text(current).slice(0, 10) === entry.date) continue;
    const group = `${entry.table}|${entry.date}`;
    const bucket = idsByTableAndDate.get(group) ?? { table: entry.table, date: entry.date, ids: [] };
    bucket.ids.push(entry.id);
    idsByTableAndDate.set(group, bucket);
  }
  if (blocked.length) {
    throw new SpedServiceError(
      `Competência fechada: reabra antes de alterar a data fiscal de ${blocked.join("; ")}.`,
      409,
      "COMPETENCE_CLOSED",
    );
  }

  const confirmedAt = new Date().toISOString();
  let updated = 0;
  for (const { table, date, ids } of idsByTableAndDate.values()) {
    const result = await supabaseAdmin
      .from(table)
      .update({
        data_entrada_fiscal: date,
        data_entrada_fiscal_confirmada_em: confirmedAt,
        data_entrada_fiscal_confirmada_por: input.actorId,
      })
      .in("id", ids)
      .eq("fiscal", true)
      .eq("status", "CONFIRMADA")
      .select("id");
    throwIfSupabaseError(result.error);
    updated += (result.data ?? []).length;
  }
  return { atualizadas: updated };
}
