import "server-only";

import { randomUUID } from "node:crypto";

import { parseCompetence } from "@/lib/fiscal-date";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  isGenerationStale,
  runSpedGeneration,
  type SpedGenerationOutcome,
  type SpedGenerationPorts,
  type SpedGenerationStage,
} from "./automaticGeneration";
import {
  applySmartSpedConfiguration,
  closeValidatedSpedCompetence,
  ensureSpedCompetenceState,
  generateSpedFileRecord,
  getSpedCompetenceDetail,
  getSpedCompetenceState,
  resolveCompanyId,
  resolveSpedCompetenceAutomatically,
  runSpedValidation,
} from "./competenciaService";
import { SpedServiceError, throwIfSupabaseError } from "./errors";
import { buildSpedPendencies, type SpedPendencyGroup, type SpedPendency } from "./pendencies";

type Row = Record<string, any>;

/** Concessão longa o bastante para a etapa mais lenta; o heartbeat a renova. */
const LEASE_SECONDS = 180;
const HEARTBEAT_MS = 30_000;

export type SpedGenerationJobView = {
  id: string;
  competencia: string;
  competenciaId: string | null;
  status: "PENDENTE" | "PROCESSANDO" | "PENDENCIAS" | "CONCLUIDA" | "FALHOU";
  etapa: string;
  etapas: Array<{ etapa: string; em: string }>;
  tentativas: number;
  criadoEm: string;
  concluidoEm: string | null;
  interrompida: boolean;
  erro: { codigo: string | null; mensagem: string } | null;
  resultado: {
    empresa: string;
    cnpj: string;
    documentos: number;
    entradas: number;
    saidas: number;
    registros: number;
    leiaute: string;
    versao: number | null;
    finalidade: string;
    statusCompetencia: string;
    itensClassificados: number;
    creditosDecididos: number;
    /** Motivo de a prévia não ter sido montada, quando houve pendências. */
    erroArquivo: string | null;
    arquivo: {
      id: string;
      nome: string;
      sha256: string;
      tamanhoBytes: number;
      linhas: number;
      geradoEm: string | null;
    } | null;
  } | null;
  pendencias: { groups: SpedPendencyGroup[]; blocking: number; warnings: SpedPendency[] } | null;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function assertJobId(value: string | number): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new SpedServiceError("Identificador de geração inválido.", 400, "INVALID_ID");
  return id;
}

async function readJob(id: string | number): Promise<Row> {
  const result = await supabaseAdmin.from("fiscal_sped_geracao").select("*").eq("id", assertJobId(id)).maybeSingle();
  throwIfSupabaseError(result.error);
  if (!result.data) throw new SpedServiceError("Geração do SPED não encontrada.", 404, "NOT_FOUND");
  return result.data as Row;
}

async function viewOf(job: Row): Promise<SpedGenerationJobView> {
  const competenciaId = job.competencia_id == null ? null : String(job.competencia_id);
  const status = text(job.status) as SpedGenerationJobView["status"];
  const base: SpedGenerationJobView = {
    id: String(job.id),
    competencia: text(job.competencia).slice(0, 7),
    competenciaId,
    status,
    etapa: text(job.etapa),
    etapas: Array.isArray(job.etapas) ? job.etapas : [],
    tentativas: number(job.tentativas),
    criadoEm: job.created_at,
    concluidoEm: job.concluido_at ?? null,
    interrompida: isGenerationStale(job),
    erro: status === "FALHOU" ? { codigo: job.erro_codigo ?? null, mensagem: text(job.erro_mensagem) || "Falha inesperada." } : null,
    resultado: null,
    pendencias: null,
  };
  if (!competenciaId || !["PENDENCIAS", "CONCLUIDA"].includes(status)) return base;

  const detail = await getSpedCompetenceDetail(competenciaId, { includeSnapshots: false });
  const stored = (job.resultado ?? {}) as Row;
  const fileId = text(stored.arquivo?.id);
  const file = fileId ? detail.arquivos.find((row) => row.id === fileId) ?? null : null;
  base.resultado = {
    empresa: detail.configuracao.estabelecimento,
    cnpj: detail.configuracao.cnpj,
    documentos: detail.contagens.total,
    entradas: detail.contagens.entradas,
    saidas: detail.contagens.saidas,
    registros: number(stored.arquivo?.lineCount ?? stored.registros),
    leiaute: text(stored.arquivo?.layout) || detail.layout,
    versao: detail.versao,
    finalidade: detail.finalidade,
    statusCompetencia: detail.status,
    itensClassificados: number(stored.resolucao?.itensCriados),
    creditosDecididos: number(stored.resolucao?.creditosCriados),
    erroArquivo: text(stored.erroArquivo) || null,
    arquivo: file ? {
      id: text(file.id),
      nome: text(file.nome),
      sha256: text(file.sha256),
      tamanhoBytes: number(file.tamanhoBytes),
      linhas: number(file.quantidadeRegistros),
      geradoEm: file.geradoEm ? text(file.geradoEm) : null,
    } : null,
  };
  if (status === "PENDENCIAS") {
    base.pendencias = buildSpedPendencies(
      detail.inconsistencias.map((row) => ({
        codigo: row.codigo,
        severidade: row.severidade,
        mensagem: row.mensagem,
        registro: row.registro,
        campo: row.campo,
        fontes: row.fontes,
      })),
      competenciaId,
    );
  }
  return base;
}

function competenceStart(competence: string): string {
  try {
    return parseCompetence(competence).start;
  } catch (error) {
    throw new SpedServiceError(error instanceof Error ? error.message : "Competência inválida.", 400, "INVALID_COMPETENCE");
  }
}

/**
 * Registra o pedido. Clique duplo ou requisição repetida devolvem o mesmo
 * pedido enquanto ele estiver ativo: o banco aceita um só por competência.
 */
export async function requestSpedGeneration(input: {
  competence: string;
  companyId?: number | null;
  actorId: string;
}): Promise<SpedGenerationJobView> {
  const start = competenceStart(input.competence);
  const companyId = await resolveCompanyId(input.companyId);
  const result = await supabaseAdmin.rpc("fiscal_sped_geracao_solicitar", {
    p_empresa_id: companyId,
    p_competencia: start,
    p_usuario_id: input.actorId,
  });
  throwIfSupabaseError(result.error);
  return viewOf(await readJob(result.data as number));
}

export async function getSpedGeneration(id: string): Promise<SpedGenerationJobView> {
  return viewOf(await readJob(id));
}

export async function getLatestSpedGeneration(input: { competence: string; companyId?: number | null }): Promise<SpedGenerationJobView | null> {
  const start = competenceStart(input.competence);
  const companyId = await resolveCompanyId(input.companyId);
  const result = await supabaseAdmin
    .from("fiscal_sped_geracao")
    .select("*")
    .eq("empresa_id", companyId)
    .eq("competencia", start)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfSupabaseError(result.error);
  return result.data ? viewOf(result.data as Row) : null;
}

/** Diz se um pedido precisa de executor: novo ou com processamento interrompido. */
export async function spedGenerationNeedsRunner(id: string): Promise<boolean> {
  const job = await readJob(id);
  return isGenerationStale(job);
}

function lostLease(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /perdeu a concessao/i.test(message);
}

/**
 * Executa (ou retoma) um pedido. Sem concessão disponível, outro executor está
 * trabalhando e esta chamada termina sem efeito. Cada etapa é idempotente; uma
 * retomada recomeça o fluxo e passa rápido pelo que já foi feito.
 */
export async function executeSpedGeneration(id: string): Promise<void> {
  const job = await readJob(id);
  const token = randomUUID();
  const claim = await supabaseAdmin.rpc("fiscal_sped_geracao_reivindicar", {
    p_id: number(job.id),
    p_token: token,
    p_lease_seconds: LEASE_SECONDS,
  });
  throwIfSupabaseError(claim.error);
  const claimed = claim.data as Row | null;
  if (!claimed?.id) return;

  const actorId = text(claimed.solicitado_por);
  const companyId = number(claimed.empresa_id);
  const competence = text(claimed.competencia).slice(0, 7);
  const heartbeat = setInterval(() => {
    void supabaseAdmin.rpc("fiscal_sped_geracao_renovar", { p_id: number(claimed.id), p_token: token, p_lease_seconds: LEASE_SECONDS });
  }, HEARTBEAT_MS);

  const ports: SpedGenerationPorts = {
    async advance(stage: SpedGenerationStage, competenceId: string | null) {
      const result = await supabaseAdmin.rpc("fiscal_sped_geracao_avancar", {
        p_id: number(claimed.id),
        p_token: token,
        p_etapa: stage,
        p_competencia_id: competenceId ? Number(competenceId) : null,
        p_lease_seconds: LEASE_SECONDS,
      });
      throwIfSupabaseError(result.error);
    },
    async ensureCompetence() {
      return ensureSpedCompetenceState({ companyId, competence, actorId });
    },
    async readCompetence(competenceId) {
      const state = await getSpedCompetenceState(competenceId);
      if (state.empresaId !== companyId) {
        throw new SpedServiceError("A competência pertence a outro estabelecimento.", 403, "COMPANY_MISMATCH");
      }
      return state;
    },
    async applySmartConfiguration() {
      await applySmartSpedConfiguration(companyId, actorId);
    },
    async resolveAutomatically(competenceId, progress) {
      return resolveSpedCompetenceAutomatically(competenceId, actorId, { progress });
    },
    async validate(competenceId, expectedVersion, progress) {
      const result = await runSpedValidation(competenceId, expectedVersion, actorId, { progress });
      return { blocked: result.blocked, recordCount: result.recordCount, reconciliation: result.reconciliation };
    },
    async close(competenceId) {
      await closeValidatedSpedCompetence(competenceId, actorId);
    },
    async generateFinal(competenceId, expectedVersion) {
      return generateSpedFileRecord(competenceId, expectedVersion, actorId, { tipo: "FINAL" });
    },
    async generatePreview(competenceId, expectedVersion) {
      return generateSpedFileRecord(competenceId, expectedVersion, actorId, { tipo: "PREVIA" });
    },
  };

  try {
    const outcome: SpedGenerationOutcome = await runSpedGeneration(ports);
    const resultado = {
      competenciaId: outcome.competenceId,
      resolucao: outcome.resolution,
      reconciliacao: outcome.validation?.reconciliation ?? null,
      registros: outcome.validation?.recordCount ?? null,
      arquivo: outcome.file,
      erroArquivo: outcome.status === "PENDENCIAS" ? outcome.previewError : null,
    };
    const done = await supabaseAdmin.rpc("fiscal_sped_geracao_concluir", {
      p_id: number(claimed.id),
      p_token: token,
      p_status: outcome.status,
      p_resultado: resultado,
      p_erro_codigo: null,
      p_erro_mensagem: null,
    });
    throwIfSupabaseError(done.error);
  } catch (error) {
    if (lostLease(error)) return;
    console.error("[sped:geracao-automatica]", error);
    const code = error instanceof SpedServiceError ? error.code : "FALHA_INTERNA";
    const message = error instanceof Error ? error.message : "Falha inesperada na geração do SPED.";
    const failed = await supabaseAdmin.rpc("fiscal_sped_geracao_concluir", {
      p_id: number(claimed.id),
      p_token: token,
      p_status: "FALHOU",
      p_resultado: null,
      p_erro_codigo: code,
      p_erro_mensagem: message,
    });
    if (failed.error && !lostLease(failed.error)) console.error("[sped:geracao-automatica]", failed.error);
  } finally {
    clearInterval(heartbeat);
  }
}
