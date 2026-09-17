import "server-only";

import { parseCompetence } from "@/lib/fiscal-date";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { normalizeAccountant, planAccountantPeriod, type SpedAccountantPeriod } from "./accountant";
import { SpedServiceError, throwIfSupabaseError } from "./errors";
import type { SpedContabilista } from "./types";

type Row = Record<string, any>;

function assertCompanyId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new SpedServiceError("Empresa inválida.", 400, "INVALID_COMPANY");
  return id;
}

function fields(raw: Record<string, unknown>) {
  const normalized = normalizeAccountant(raw);
  if ("errors" in normalized) {
    throw new SpedServiceError(normalized.errors.join(" "), 400, "INVALID_ACCOUNTANT");
  }
  return normalized.value;
}

export function toSpedContabilista(row: Row): SpedContabilista {
  return {
    id: String(row.id),
    vigenciaInicio: String(row.vigencia_inicio).slice(0, 10),
    vigenciaFim: row.vigencia_fim ? String(row.vigencia_fim).slice(0, 10) : null,
    nome: row.nome,
    cpf: row.cpf,
    crc: row.crc,
    cnpjEscritorio: row.cnpj_escritorio ?? null,
    cep: row.cep ?? "",
    endereco: row.endereco ?? "",
    numero: row.numero ?? "",
    complemento: row.complemento ?? null,
    bairro: row.bairro ?? "",
    telefone: row.telefone ?? null,
    fax: row.fax ?? null,
    email: row.email ?? "",
    codigoMunicipio: row.codigo_municipio ?? "",
  };
}

export async function listSpedAccountants(companyId: unknown): Promise<SpedContabilista[]> {
  const result = await supabaseAdmin
    .from("fiscal_sped_contabilista")
    .select("*")
    .eq("empresa_id", assertCompanyId(companyId))
    .order("vigencia_inicio", { ascending: false });
  throwIfSupabaseError(result.error);
  return ((result.data ?? []) as Row[]).map(toSpedContabilista);
}

/** Cadastra o contador que responde pela escrituração a partir de uma competência (AAAA-MM). */
export async function createSpedAccountant(input: {
  companyId: unknown;
  aPartirDe: unknown;
  data: Record<string, unknown>;
  actorId: string;
}) {
  const companyId = assertCompanyId(input.companyId);
  let start: string;
  try {
    start = parseCompetence(String(input.aPartirDe ?? "")).start;
  } catch {
    throw new SpedServiceError("Informe a competência a partir da qual o contador responde.", 400, "INVALID_START");
  }
  const values = fields(input.data);

  const existing = await supabaseAdmin
    .from("fiscal_sped_contabilista")
    .select("id, vigencia_inicio, vigencia_fim")
    .eq("empresa_id", companyId);
  throwIfSupabaseError(existing.error);
  const plan = planAccountantPeriod((existing.data ?? []) as SpedAccountantPeriod[], start);
  if ("error" in plan) throw new SpedServiceError(plan.error, 409, "ACCOUNTANT_PERIOD_EXISTS");

  // Insere antes de encerrar o anterior: se o encerramento falhar, a competência
  // ainda escolhe o contador de início mais recente e nenhum mês fica sem 0100.
  const inserted = await supabaseAdmin
    .from("fiscal_sped_contabilista")
    .insert({
      ...values,
      empresa_id: companyId,
      vigencia_inicio: start,
      vigencia_fim: plan.end,
      created_by: input.actorId,
      updated_by: input.actorId,
    })
    .select("*")
    .single();
  throwIfSupabaseError(inserted.error);

  if (plan.closePrevious) {
    const closed = await supabaseAdmin
      .from("fiscal_sped_contabilista")
      .update({ vigencia_fim: plan.closePrevious.end, updated_by: input.actorId })
      .eq("id", plan.closePrevious.id)
      .eq("empresa_id", companyId);
    throwIfSupabaseError(closed.error);
  }
  return toSpedContabilista(inserted.data as Row);
}

/** Corrige os dados de um contador sem mexer na vigência. Meses já fechados guardam o 0100 do fechamento. */
export async function updateSpedAccountant(input: {
  companyId: unknown;
  id: unknown;
  data: Record<string, unknown>;
  actorId: string;
}) {
  const companyId = assertCompanyId(input.companyId);
  const id = Number(input.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new SpedServiceError("Contador inválido.", 400, "INVALID_ID");
  const values = fields(input.data);
  const result = await supabaseAdmin
    .from("fiscal_sped_contabilista")
    .update({ ...values, updated_by: input.actorId })
    .eq("id", id)
    .eq("empresa_id", companyId)
    .select("*")
    .maybeSingle();
  throwIfSupabaseError(result.error);
  if (!result.data) throw new SpedServiceError("Contador não encontrado.", 404, "NOT_FOUND");
  return toSpedContabilista(result.data as Row);
}
