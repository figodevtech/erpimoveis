import "server-only";

import { isValidCivilDate } from "@/lib/fiscal-date";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { SpedServiceError, throwIfSupabaseError } from "./errors";
import { civilDateInTimezone, closedMonthsAffectedByDateChange } from "./guards";
import type { SpedEntradaDataFiscalPendente } from "./types";

type Row = Record<string, any>;

const MAX_BATCH = 500;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

/** Entradas fiscais confirmadas no estoque que ainda não têm data de escrituração confirmada. */
export async function listPendingEntryFiscalDates(): Promise<SpedEntradaDataFiscalPendente[]> {
  const configResult = await supabaseAdmin.from("fiscal_sped_config").select("timezone_iana").order("empresa_id").limit(1).maybeSingle();
  throwIfSupabaseError(configResult.error);
  const timeZone = text(configResult.data?.timezone_iana) || null;
  const result = await supabaseAdmin
    .from("entrada")
    .select(`
      id, created_at, data_emissao, numero_nota, serie_nota, notachave, valor_total,
      data_entrada_fiscal_sugerida,
      fornecedor:fornecedorid(nomerazaosocial, nomefantasia, cpfcnpj),
      dfe:fiscal_dfe_documento_id(data_emissao)
    `)
    .eq("fiscal", true)
    .eq("status", "CONFIRMADA")
    .is("data_entrada_fiscal", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(MAX_BATCH);
  throwIfSupabaseError(result.error);
  return ((result.data ?? []) as Row[]).map((row) => {
    const fornecedor = (Array.isArray(row.fornecedor) ? row.fornecedor[0] : row.fornecedor) as Row | null;
    const dfe = (Array.isArray(row.dfe) ? row.dfe[0] : row.dfe) as Row | null;
    return {
      id: String(row.id),
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
      dataSugerida: text(row.data_entrada_fiscal_sugerida).slice(0, 10) || null,
    };
  });
}

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

  const dateById = new Map<number, string>();
  for (const raw of input.items as Row[]) {
    const id = Number(raw?.id);
    const date = text(raw?.dataEntradaFiscal);
    if (!Number.isSafeInteger(id) || id <= 0) throw new SpedServiceError("Entrada inválida.", 400, "INVALID_ID");
    if (!isValidCivilDate(date)) throw new SpedServiceError(`Data fiscal inválida na entrada ${id}.`, 400, "INVALID_DATE");
    if (dateById.has(id) && dateById.get(id) !== date) {
      throw new SpedServiceError(`A entrada ${id} veio com duas datas diferentes.`, 400, "DUPLICATE_ENTRY");
    }
    dateById.set(id, date);
  }

  const ids = Array.from(dateById.keys());
  const [entriesResult, closedResult] = await Promise.all([
    supabaseAdmin.from("entrada").select("id, data_entrada_fiscal").in("id", ids).eq("fiscal", true).eq("status", "CONFIRMADA"),
    supabaseAdmin.from("fiscal_sped_competencia").select("competencia").eq("status", "FECHADA"),
  ]);
  throwIfSupabaseError(entriesResult.error);
  throwIfSupabaseError(closedResult.error);

  const currentById = new Map(((entriesResult.data ?? []) as Row[]).map((row) => [Number(row.id), row.data_entrada_fiscal as string | null]));
  const missing = ids.filter((id) => !currentById.has(id));
  if (missing.length) {
    throw new SpedServiceError(`Entradas fiscais confirmadas não encontradas: ${missing.join(", ")}.`, 404, "ENTRY_NOT_FOUND");
  }

  const closedMonths = new Set(((closedResult.data ?? []) as Row[]).map((row) => text(row.competencia).slice(0, 7)));
  const blocked: string[] = [];
  const idsByDate = new Map<string, number[]>();
  for (const [id, date] of dateById) {
    const current = currentById.get(id);
    const months = closedMonthsAffectedByDateChange(current, date, closedMonths);
    if (months.length) blocked.push(`entrada ${id} (${months.join(", ")})`);
    if (text(current).slice(0, 10) === date) continue;
    idsByDate.set(date, [...(idsByDate.get(date) ?? []), id]);
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
  for (const [date, dateIds] of idsByDate) {
    const result = await supabaseAdmin
      .from("entrada")
      .update({
        data_entrada_fiscal: date,
        data_entrada_fiscal_confirmada_em: confirmedAt,
        data_entrada_fiscal_confirmada_por: input.actorId,
      })
      .in("id", dateIds)
      .eq("fiscal", true)
      .eq("status", "CONFIRMADA")
      .select("id");
    throwIfSupabaseError(result.error);
    updated += (result.data ?? []).length;
  }
  return { atualizadas: updated };
}
