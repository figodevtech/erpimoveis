import "server-only";

import {
  parse1601Csv,
  parsePreviousEfd,
  previousCompetence,
} from "@/lib/sped/efd-icms-ipi";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { SpedServiceError, throwIfSupabaseError } from "./errors";
import { sha256Hex } from "./hash";

const STORAGE_BUCKET = "fiscal-sped";
const MAX_PREVIOUS_EFD_BYTES = 25 * 1024 * 1024;
const MAX_1601_BYTES = 5 * 1024 * 1024;

type Row = Record<string, any>;

function assertId(value: string | number): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new SpedServiceError("Identificador SPED inválido.", 400, "INVALID_ID");
  }
  return id;
}

function safeFileName(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 120) || fallback;
}

async function loadImportContext(competenceId: number) {
  const competenceResult = await supabaseAdmin
    .from("fiscal_sped_competencia")
    .select("id, empresa_id, competencia, status")
    .eq("id", competenceId)
    .maybeSingle();
  throwIfSupabaseError(competenceResult.error);
  const competence = competenceResult.data as Row | null;
  if (!competence) throw new SpedServiceError("Competência SPED não encontrada.", 404, "NOT_FOUND");
  if (competence.status === "FECHADA") {
    throw new SpedServiceError("Competência fechada não aceita importações.", 409, "COMPETENCE_CLOSED");
  }
  const companyResult = await supabaseAdmin
    .from("empresa")
    .select("id, cnpj")
    .eq("id", competence.empresa_id)
    .maybeSingle();
  throwIfSupabaseError(companyResult.error);
  if (!companyResult.data) throw new SpedServiceError("Estabelecimento não encontrado.", 404, "COMPANY_NOT_FOUND");
  return { competence, company: companyResult.data as Row };
}

async function uploadOriginal(path: string, bytes: Uint8Array, contentType: string) {
  const uploaded = await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
  });
  throwIfSupabaseError(uploaded.error);
}

async function removeUploaded(path: string) {
  await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([path]).catch(() => undefined);
}

export async function importPreviousEfd(input: {
  competenceId: string | number;
  actorId: string;
  fileName: string;
  bytes: Uint8Array;
}) {
  const competenceId = assertId(input.competenceId);
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_PREVIOUS_EFD_BYTES) {
    throw new SpedServiceError("A EFD anterior deve ter entre 1 byte e 25 MB.", 400, "INVALID_FILE_SIZE");
  }
  const { competence, company } = await loadImportContext(competenceId);
  const competenceText = String(competence.competencia).slice(0, 7);
  let parsed;
  try {
    parsed = parsePreviousEfd(Buffer.from(input.bytes).toString("latin1"), competenceText, company.cnpj);
  } catch (error) {
    throw new SpedServiceError(error instanceof Error ? error.message : "EFD anterior inválida.", 422, "INVALID_PREVIOUS_EFD");
  }
  const hash = sha256Hex(input.bytes);
  const existing = await supabaseAdmin
    .from("fiscal_sped_efd_anterior_importacao")
    .select("id")
    .eq("competencia_id", competenceId)
    .eq("arquivo_sha256", hash)
    .maybeSingle();
  throwIfSupabaseError(existing.error);
  if (existing.data) return { id: String(existing.data.id), duplicate: true, parsed };

  const fileName = safeFileName(input.fileName, "efd-anterior.txt");
  const path = `${competence.empresa_id}/${competenceText}/importacoes/efd-anterior/${Date.now()}-${hash}-${fileName}`;
  await uploadOriginal(path, input.bytes, "text/plain");
  try {
    const imported = await supabaseAdmin.rpc("fiscal_sped_importar_efd_anterior", {
      p_competencia_id: competenceId,
      p_competencia_arquivo: `${previousCompetence(competenceText)}-01`,
      p_nome_arquivo: fileName,
      p_storage_path: path,
      p_arquivo_sha256: hash,
      p_cabecalho: { ...parsed.header, lineCount: parsed.lineCount },
      p_saldos_apuracao: parsed.balances,
      p_usuario_id: input.actorId,
    });
    throwIfSupabaseError(imported.error);
    return { id: String(imported.data), duplicate: false, parsed };
  } catch (error) {
    await removeUploaded(path);
    throw error;
  }
}

export async function import1601Csv(input: {
  competenceId: string | number;
  actorId: string;
  fileName: string;
  bytes: Uint8Array;
}) {
  const competenceId = assertId(input.competenceId);
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_1601_BYTES) {
    throw new SpedServiceError("O CSV do 1601 deve ter entre 1 byte e 5 MB.", 400, "INVALID_FILE_SIZE");
  }
  const { competence } = await loadImportContext(competenceId);
  const competenceText = String(competence.competencia).slice(0, 7);
  let lines;
  try {
    lines = parse1601Csv(Buffer.from(input.bytes).toString("utf8"));
  } catch (error) {
    throw new SpedServiceError(error instanceof Error ? error.message : "CSV 1601 inválido.", 422, "INVALID_1601_CSV");
  }
  const hash = sha256Hex(input.bytes);
  const existing = await supabaseAdmin
    .from("fiscal_sped_1601_importacao")
    .select("id")
    .eq("competencia_id", competenceId)
    .eq("arquivo_sha256", hash)
    .maybeSingle();
  throwIfSupabaseError(existing.error);
  if (existing.data) return { id: String(existing.data.id), duplicate: true, lineCount: lines.length };

  const fileName = safeFileName(input.fileName, "registro-1601.csv");
  const path = `${competence.empresa_id}/${competenceText}/importacoes/1601/${Date.now()}-${hash}-${fileName}`;
  await uploadOriginal(path, input.bytes, "text/csv");
  try {
    const imported = await supabaseAdmin.rpc("fiscal_sped_importar_1601", {
      p_competencia_id: competenceId,
      p_nome_arquivo: fileName,
      p_storage_path: path,
      p_arquivo_sha256: hash,
      p_linhas: lines.map((line) => ({
        numero_linha: line.lineNumber,
        instituicao_cnpj: line.institutionCnpj,
        instituicao_nome: line.institutionName,
        instituicao_codigo_participante: line.institutionParticipantCode,
        intermediario_cnpj: line.intermediaryCnpj,
        intermediario_nome: line.intermediaryName,
        intermediario_codigo_participante: line.intermediaryParticipantCode,
        total_operacoes: line.totalOperations,
        total_iss: line.totalIss,
        total_outros: line.totalOthers,
        dados_origem: line.source,
      })),
      p_usuario_id: input.actorId,
    });
    throwIfSupabaseError(imported.error);
    return { id: String(imported.data), duplicate: false, lineCount: lines.length };
  } catch (error) {
    await removeUploaded(path);
    throw error;
  }
}
