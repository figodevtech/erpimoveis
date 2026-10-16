import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isGenerationStale,
  monotonicProgress,
  runSpedGeneration,
  type SpedGenerationFile,
  type SpedGenerationPorts,
  type SpedGenerationStage,
} from "./automaticGeneration";

type World = {
  status: string;
  version: number | null;
  blocked: boolean;
  files: Map<string, SpedGenerationFile>;
  calls: string[];
  stages: SpedGenerationStage[];
  crashAt?: string;
  leaseLostAt?: SpedGenerationStage;
};

function world(overrides: Partial<World> = {}): World {
  return { status: "ABERTA", version: null, blocked: false, files: new Map(), calls: [], stages: [], ...overrides };
}

/** Portas com o mesmo contrato das reais: validar abre versão, fechar exige APTA, FINAL exige FECHADA. */
function ports(state: World): SpedGenerationPorts {
  const crash = (step: string) => {
    if (state.crashAt === step) {
      state.crashAt = undefined;
      throw new Error(`queda simulada em ${step}`);
    }
  };
  return {
    async advance(stage) {
      if (state.leaseLostAt === stage) throw new Error("Processamento SPED perdeu a concessao.");
      state.stages.push(stage);
    },
    async ensureCompetence() {
      state.calls.push("ensure");
      return { id: "7", status: state.status, versionNumber: state.version };
    },
    async readCompetence() {
      return { id: "7", status: state.status, versionNumber: state.version };
    },
    async applySmartConfiguration() {
      state.calls.push("config");
    },
    async resolveAutomatically(_id, progress) {
      state.calls.push("resolve");
      await progress("RESOLVENDO_CADASTROS");
      return { itensCriados: 3, creditosCriados: 2 };
    },
    async validate(_id, expectedVersion, progress) {
      state.calls.push("validate");
      assert.equal(expectedVersion, state.version, "validação usa a versão atual");
      await progress("COLETANDO_DOCUMENTOS");
      await progress("CALCULANDO_APURACAO");
      crash("validate");
      await progress("MONTANDO_REGISTROS");
      state.version = state.version ?? 1;
      state.status = state.blocked ? "COM_ERROS" : "APTA";
      return { blocked: state.blocked, recordCount: 120, reconciliation: { balanced: true } };
    },
    async close() {
      state.calls.push("close");
      if (state.status !== "APTA") throw new Error("NOT_READY");
      crash("close");
      state.status = "FECHADA";
    },
    async generateFinal(_id, expectedVersion) {
      state.calls.push("generate");
      if (state.status !== "FECHADA") throw new Error("VERSION_NOT_CLOSED");
      crash("generate");
      const key = `v${expectedVersion}`;
      const existing = state.files.get(key);
      if (existing) return { ...existing, created: false };
      const file: SpedGenerationFile = { id: String(state.files.size + 1), tipo: "FINAL", sha256: "f".repeat(64), lineCount: 120, sizeBytes: 9000, layout: "020", versao: Number(expectedVersion), created: true };
      state.files.set(key, file);
      return file;
    },
  };
}

describe("geração em um clique", () => {
  it("competência completa: valida, fecha e gera o FINAL", async () => {
    const state = world();
    const outcome = await runSpedGeneration(ports(state));
    assert.equal(outcome.status, "CONCLUIDA");
    assert.equal(state.status, "FECHADA");
    assert.deepEqual(state.calls, ["ensure", "config", "resolve", "validate", "close", "generate"]);
    if (outcome.status === "CONCLUIDA") {
      assert.equal(outcome.file.tipo, "FINAL");
      assert.deepEqual(outcome.resolution, { itensCriados: 3, creditosCriados: 2 });
    }
  });

  it("progresso real e só para frente, mesmo com a coleta repetida na validação", async () => {
    const state = world();
    await runSpedGeneration(ports(state));
    assert.deepEqual(state.stages, [
      "PREPARANDO", "COLETANDO_DOCUMENTOS", "RESOLVENDO_CADASTROS", "CALCULANDO_APURACAO",
      "MONTANDO_REGISTROS", "VALIDANDO", "FECHANDO", "GERANDO_ARQUIVO",
    ]);
  });

  it("com pendências: não fecha e nunca gera FINAL", async () => {
    const state = world({ blocked: true });
    const outcome = await runSpedGeneration(ports(state));
    assert.equal(outcome.status, "PENDENCIAS");
    assert.equal(state.calls.includes("close"), false);
    assert.equal(state.calls.includes("generate"), false);
    assert.equal(state.files.size, 0);
  });

  it("gerar de novo uma competência fechada devolve o mesmo arquivo", async () => {
    const state = world();
    const first = await runSpedGeneration(ports(state));
    const second = await runSpedGeneration(ports(state));
    assert.equal(first.status, "CONCLUIDA");
    assert.equal(second.status, "CONCLUIDA");
    if (first.status === "CONCLUIDA" && second.status === "CONCLUIDA") {
      assert.equal(second.file.id, first.file.id);
      assert.equal(second.file.created, false);
    }
    assert.equal(state.files.size, 1);
    assert.equal(state.calls.filter((call) => call === "validate").length, 1, "competência fechada não é revalidada");
  });

  for (const step of ["validate", "close", "generate"]) {
    it(`interrompida em ${step}: a retomada conclui sem duplicar`, async () => {
      const state = world({ crashAt: step });
      await assert.rejects(runSpedGeneration(ports(state)), /queda simulada/);
      const resumed = await runSpedGeneration(ports(state));
      assert.equal(resumed.status, "CONCLUIDA");
      assert.equal(state.status, "FECHADA");
      assert.equal(state.files.size, 1);
    });
  }

  it("concessão perdida interrompe antes de qualquer efeito seguinte", async () => {
    const state = world({ leaseLostAt: "FECHANDO" });
    await assert.rejects(runSpedGeneration(ports(state)), /perdeu a concessao/);
    assert.equal(state.calls.includes("close"), false);
    assert.equal(state.files.size, 0);
  });

  it("dois executores: o segundo só age depois que o primeiro terminou e não duplica", async () => {
    const state = world();
    const [a, b] = await Promise.allSettled([runSpedGeneration(ports(state)), runSpedGeneration(ports(state))]);
    // As portas reais impedem a execução simultânea pela concessão do banco;
    // aqui, mesmo sem ela, o contrato idempotente evita arquivo em dobro.
    assert.ok([a, b].some((result) => result.status === "fulfilled"));
    assert.equal(state.files.size, 1);
  });
});

describe("retomada", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  it("pedido pendente sem concessão precisa de executor", () => {
    assert.equal(isGenerationStale({ status: "PENDENTE", lease_until: null }, now), true);
  });
  it("processamento com concessão válida não é retomado", () => {
    assert.equal(isGenerationStale({ status: "PROCESSANDO", lease_until: "2026-10-15T12:01:00Z" }, now), false);
  });
  it("processamento com concessão vencida é retomado", () => {
    assert.equal(isGenerationStale({ status: "PROCESSANDO", lease_until: "2026-10-15T11:59:00Z" }, now), true);
  });
  it("pedido concluído nunca é retomado", () => {
    assert.equal(isGenerationStale({ status: "CONCLUIDA", lease_until: null }, now), false);
    assert.equal(isGenerationStale({ status: "PENDENCIAS" }, now), false);
  });
  it("progresso ignora etapas repetidas ou anteriores", async () => {
    const seen: SpedGenerationStage[] = [];
    const progress = monotonicProgress(async (stage) => { seen.push(stage); });
    await progress("VALIDANDO");
    await progress("COLETANDO_DOCUMENTOS");
    await progress("VALIDANDO");
    await progress("FECHANDO");
    assert.deepEqual(seen, ["VALIDANDO", "FECHANDO"]);
  });
});
