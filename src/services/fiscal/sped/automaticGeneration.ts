/**
 * Geração do SPED Fiscal em um clique.
 *
 * O fluxo coordena as operações que já existiam (validar, fechar, gerar) e as
 * novas (configuração inteligente, resolução automática), sempre na mesma
 * ordem. Cada operação é idempotente: um processamento interrompido recomeça
 * do início e passa rápido pelo que já foi feito. O arquivo FINAL só é gerado
 * de versão fechada, e a versão só fecha sem bloqueios.
 *
 * As dependências entram por portas para que o fluxo seja testável sem banco.
 */

export const SPED_GENERATION_STAGES = [
  "PREPARANDO",
  "COLETANDO_DOCUMENTOS",
  "RESOLVENDO_CADASTROS",
  "CALCULANDO_APURACAO",
  "MONTANDO_REGISTROS",
  "VALIDANDO",
  "FECHANDO",
  "GERANDO_ARQUIVO",
] as const;
export type SpedGenerationStage = (typeof SPED_GENERATION_STAGES)[number];

export type SpedGenerationCompetence = {
  id: string;
  status: string;
  versionNumber: number | null;
};

export type SpedGenerationFile = {
  id: string;
  tipo: "PREVIA" | "FINAL";
  sha256: string;
  lineCount: number;
  sizeBytes: number;
  layout: string;
  versao: number;
  created: boolean;
};

export type SpedGenerationValidation = {
  blocked: boolean;
  recordCount: number;
  reconciliation?: Record<string, unknown> | null;
};

export type SpedGenerationPorts = {
  /** Persiste a etapa e renova a concessão. Lança se a concessão foi perdida. */
  advance(stage: SpedGenerationStage, competenceId: string | null): Promise<void>;
  ensureCompetence(): Promise<SpedGenerationCompetence>;
  readCompetence(competenceId: string): Promise<SpedGenerationCompetence>;
  applySmartConfiguration(): Promise<void>;
  resolveAutomatically(competenceId: string, progress: (stage: SpedGenerationStage) => Promise<void>): Promise<{
    itensCriados: number;
    creditosCriados: number;
  }>;
  validate(
    competenceId: string,
    expectedVersion: number | null,
    progress: (stage: SpedGenerationStage) => Promise<void>,
  ): Promise<SpedGenerationValidation>;
  close(competenceId: string): Promise<void>;
  generateFinal(competenceId: string, expectedVersion: number | null): Promise<SpedGenerationFile>;
};

export type SpedGenerationOutcome =
  | {
    status: "CONCLUIDA";
    competenceId: string;
    file: SpedGenerationFile;
    resolution: { itensCriados: number; creditosCriados: number } | null;
    validation: SpedGenerationValidation | null;
  }
  | {
    status: "PENDENCIAS";
    competenceId: string;
    resolution: { itensCriados: number; creditosCriados: number } | null;
    validation: SpedGenerationValidation;
  };

/** Etapas só avançam: a coleta repetida dentro da validação não faz a barra voltar. */
export function monotonicProgress(advance: (stage: SpedGenerationStage) => Promise<void>) {
  let current = -1;
  return async (stage: SpedGenerationStage) => {
    const index = SPED_GENERATION_STAGES.indexOf(stage);
    if (index <= current) return;
    current = index;
    await advance(stage);
  };
}

export async function runSpedGeneration(ports: SpedGenerationPorts): Promise<SpedGenerationOutcome> {
  let competenceId: string | null = null;
  const progress = monotonicProgress((stage) => ports.advance(stage, competenceId));

  await progress("PREPARANDO");
  let competence = await ports.ensureCompetence();
  competenceId = competence.id;

  if (competence.status === "FECHADA") {
    // Competência já fechada: o arquivo é o da versão fechada. Gerar de novo
    // produz o mesmo hash e reaproveita o registro existente.
    await progress("GERANDO_ARQUIVO");
    const file = await ports.generateFinal(competence.id, competence.versionNumber);
    return { status: "CONCLUIDA", competenceId: competence.id, file, resolution: null, validation: null };
  }

  await ports.applySmartConfiguration();
  await progress("COLETANDO_DOCUMENTOS");
  const resolution = await ports.resolveAutomatically(competence.id, progress);
  await progress("RESOLVENDO_CADASTROS");

  competence = await ports.readCompetence(competence.id);
  const validation = await ports.validate(competence.id, competence.versionNumber, progress);
  await progress("VALIDANDO");
  if (validation.blocked) {
    return { status: "PENDENCIAS", competenceId: competence.id, resolution, validation };
  }

  await progress("FECHANDO");
  await ports.close(competence.id);
  competence = await ports.readCompetence(competence.id);
  if (competence.status !== "FECHADA") {
    throw new Error("A competência não ficou fechada após o fechamento; o arquivo FINAL não foi gerado.");
  }

  await progress("GERANDO_ARQUIVO");
  const file = await ports.generateFinal(competence.id, competence.versionNumber);
  return { status: "CONCLUIDA", competenceId: competence.id, file, resolution, validation };
}

/** Uma concessão vencida indica processamento interrompido, que pode ser retomado. */
export function isGenerationStale(job: { status?: unknown; lease_until?: unknown }, now = Date.now()): boolean {
  if (job.status !== "PENDENTE" && job.status !== "PROCESSANDO") return false;
  const lease = typeof job.lease_until === "string" ? Date.parse(job.lease_until) : Number.NaN;
  return !Number.isFinite(lease) || lease < now;
}
