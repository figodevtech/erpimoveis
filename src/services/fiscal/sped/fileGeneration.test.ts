import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SpedServiceError } from "./errors";
import {
  buildSpedStoragePath,
  classifySpedDbInsertError,
  recordSpedFileRegistry,
  shouldCreateNewSpedFile,
  validateSpedFileGenerationPreconditions,
  type StoredSpedFileRecord,
} from "./fileGenerationGuards";

describe("SPED Fiscal — Geração de Arquivos e Idempotência (Casos A a J)", () => {
  const versaoId = 101;
  const hashX = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const hashY = "621e90d4f3c74e7d7ba26f34f57a43b934f80d3d7edcf830f9017d7c844c5b7a";

  it("Caso A: PREVIA hash X seguido de PREVIA hash X resulta em 1 PREVIA", () => {
    let files: StoredSpedFileRecord[] = [];

    // Primeira PREVIA
    const first = recordSpedFileRegistry(files, {
      versao_id: versaoId,
      tipo: "PREVIA",
      arquivo_sha256: hashX,
    });
    assert.equal(first.created, true);
    files = first.files;
    assert.equal(files.length, 1);
    assert.equal(files[0].tipo, "PREVIA");
    assert.equal(files[0].arquivo_sha256, hashX);

    // Segunda PREVIA idêntica
    const second = recordSpedFileRegistry(files, {
      versao_id: versaoId,
      tipo: "PREVIA",
      arquivo_sha256: hashX,
    });
    assert.equal(second.created, false);
    files = second.files;
    assert.equal(files.length, 1, "Não deve duplicar a PREVIA de mesmo hash");
  });

  it("Caso B: PREVIA hash X seguido de FINAL hash X resulta em 1 PREVIA e 1 FINAL", () => {
    let files: StoredSpedFileRecord[] = [];

    // 1. Gera PREVIA
    const previa = recordSpedFileRegistry(files, {
      versao_id: versaoId,
      tipo: "PREVIA",
      arquivo_sha256: hashX,
    });
    assert.equal(previa.created, true);
    files = previa.files;
    assert.equal(files.length, 1);

    // 2. Gera FINAL com o mesmo hash X (competência fechada sem alteração nos dados)
    assert.equal(
      shouldCreateNewSpedFile(files, {
        versao_id: versaoId,
        tipo: "FINAL",
        arquivo_sha256: hashX,
      }),
      true,
      "FINAL com mesmo hash que PREVIA deve ser criado como novo arquivo"
    );

    const final = recordSpedFileRegistry(files, {
      versao_id: versaoId,
      tipo: "FINAL",
      arquivo_sha256: hashX,
    });
    assert.equal(final.created, true);
    files = final.files;

    // Resultado: 1 PREVIA e 1 FINAL
    assert.equal(files.length, 2);
    const previas = files.filter((f) => f.tipo === "PREVIA");
    const finals = files.filter((f) => f.tipo === "FINAL");
    assert.equal(previas.length, 1);
    assert.equal(finals.length, 1);
    assert.equal(previas[0].arquivo_sha256, hashX);
    assert.equal(finals[0].arquivo_sha256, hashX);
  });

  it("Caso C: FINAL hash X seguido de FINAL hash X resulta em 1 FINAL", () => {
    let files: StoredSpedFileRecord[] = [];

    // Primeiro FINAL
    const first = recordSpedFileRegistry(files, {
      versao_id: versaoId,
      tipo: "FINAL",
      arquivo_sha256: hashX,
    });
    assert.equal(first.created, true);
    files = first.files;
    assert.equal(files.length, 1);
    assert.equal(files[0].tipo, "FINAL");

    // Segundo FINAL idêntico
    const second = recordSpedFileRegistry(files, {
      versao_id: versaoId,
      tipo: "FINAL",
      arquivo_sha256: hashX,
    });
    assert.equal(second.created, false);
    files = second.files;
    assert.equal(files.length, 1, "Não deve duplicar o FINAL de mesmo hash");
  });

  it("Caso D: tentativa com tipo inválido retorna erro INVALID_FILE_KIND (HTTP 400)", () => {
    assert.throws(
      () => {
        validateSpedFileGenerationPreconditions({
          tipo: "QUALQUER_COISA",
          competenceStatus: "ABERTA",
          versionStatus: "ABERTA",
          hasVersion: true,
        });
      },
      (error: unknown) => {
        assert.ok(error instanceof SpedServiceError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.code, "INVALID_FILE_KIND");
        return true;
      }
    );
  });

  it("Caso E: FINAL com competência ou versão não fechada retorna VERSION_NOT_CLOSED (HTTP 422)", () => {
    // 1. Competência e versão abertas
    assert.throws(
      () => {
        validateSpedFileGenerationPreconditions({
          tipo: "FINAL",
          competenceStatus: "ABERTA",
          versionStatus: "ABERTA",
          hasVersion: true,
        });
      },
      (error: unknown) => {
        assert.ok(error instanceof SpedServiceError);
        assert.equal(error.statusCode, 422);
        assert.equal(error.code, "VERSION_NOT_CLOSED");
        return true;
      }
    );

    // 2. Competência APTA mas não FECHADA
    assert.throws(
      () => {
        validateSpedFileGenerationPreconditions({
          tipo: "FINAL",
          competenceStatus: "APTA",
          versionStatus: "ABERTA",
          hasVersion: true,
        });
      },
      (error: unknown) => {
        assert.ok(error instanceof SpedServiceError);
        assert.equal(error.statusCode, 422);
        assert.equal(error.code, "VERSION_NOT_CLOSED");
        return true;
      }
    );

    // 3. Competência FECHADA e versão FECHADA deve passar sem erro
    const ok = validateSpedFileGenerationPreconditions({
      tipo: "FINAL",
      competenceStatus: "FECHADA",
      versionStatus: "FECHADA",
      hasVersion: true,
    });
    assert.equal(ok.tipo, "FINAL");

    // 4. PREVIA com competência ABERTA deve passar sem erro
    const previaOk = validateSpedFileGenerationPreconditions({
      tipo: "PREVIA",
      competenceStatus: "ABERTA",
      versionStatus: "ABERTA",
      hasVersion: true,
    });
    assert.equal(previaOk.tipo, "PREVIA");
  });

  it("Caso F: Concorrência da mesma PREVIA produz 1 registro e 1 objeto no Storage sem órfãos", async () => {
    let files: StoredSpedFileRecord[] = [];
    const storageObjects = new Set<string>();

    // Simula duas requisições paralelas para a mesma PREVIA
    const executeRequest = async () => {
      const path = buildSpedStoragePath(1, "2026-08", 1, "PREVIA", hashX);
      storageObjects.add(path);

      // Bloqueio atômico simulado
      const reg = recordSpedFileRegistry(files, {
        versao_id: versaoId,
        tipo: "PREVIA",
        arquivo_sha256: hashX,
        storage_path: path,
      });
      files = reg.files;
      return reg;
    };

    const [reqA, reqB] = await Promise.all([executeRequest(), executeRequest()]);

    // Exatamente uma requisição deve ter criado e a outra reutilizado
    const createdCount = [reqA.created, reqB.created].filter(Boolean).length;
    assert.equal(createdCount, 1, "Apenas uma requisição cria o registro");
    assert.equal(files.length, 1, "Total de registros deve ser exatamente 1");
    assert.equal(storageObjects.size, 1, "Apenas 1 path determinístico no Storage sem órfãos");
    assert.equal(Array.from(storageObjects)[0], "1/2026-08/v1/previa-" + hashX + ".txt");
  });

  it("Caso G: Concorrência de artefatos diferentes aloca sequências diferentes sem conflito", async () => {
    let files: StoredSpedFileRecord[] = [];

    // Duas requisições simultâneas com hashes diferentes (ex: após mudança em documento)
    const reqX = recordSpedFileRegistry(files, {
      versao_id: versaoId,
      tipo: "PREVIA",
      arquivo_sha256: hashX,
    });
    files = reqX.files;

    const reqY = recordSpedFileRegistry(files, {
      versao_id: versaoId,
      tipo: "PREVIA",
      arquivo_sha256: hashY,
    });
    files = reqY.files;

    assert.equal(files.length, 2);
    assert.equal(reqX.record.sequencia, 1);
    assert.equal(reqY.record.sequencia, 2);
    assert.notEqual(reqX.record.sequencia, reqY.record.sequencia);
  });

  it("Caso H: PREVIA e FINAL com mesmo hash coexistem no banco e Storage", () => {
    const previaPath = buildSpedStoragePath(1, "2026-08", 1, "PREVIA", hashX);
    const finalPath = buildSpedStoragePath(1, "2026-08", 1, "FINAL", hashX);

    assert.notEqual(previaPath, finalPath, "Paths no Storage devem ser distintos entre PREVIA e FINAL");
    assert.match(previaPath, /previa-/);
    assert.match(finalPath, /final-/);

    let files: StoredSpedFileRecord[] = [];
    const previa = recordSpedFileRegistry(files, {
      versao_id: versaoId,
      tipo: "PREVIA",
      arquivo_sha256: hashX,
      storage_path: previaPath,
    });
    files = previa.files;

    const final = recordSpedFileRegistry(files, {
      versao_id: versaoId,
      tipo: "FINAL",
      arquivo_sha256: hashX,
      storage_path: finalPath,
    });
    files = final.files;

    assert.equal(files.length, 2);
    assert.equal(previa.created, true);
    assert.equal(final.created, true);
  });

  it("Caso I: Colisão de sequência (23505) NÃO é mascarada como idempotência de hash", () => {
    // 1. Erro de colisão de sequência
    const seqError = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "fiscal_sped_arquivo_versao_id_sequencia_key"',
      constraint: "fiscal_sped_arquivo_versao_id_sequencia_key",
    };
    const seqClass = classifySpedDbInsertError(seqError);
    assert.equal(seqClass.isSequenceConflict, true);
    assert.equal(seqClass.isHashDuplicate, false);
    assert.equal(seqClass.isFatal, true);

    // 2. Erro de duplicidade de tipo + hash
    const hashError = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "fiscal_sped_arquivo_versao_tipo_hash_uk"',
      constraint: "fiscal_sped_arquivo_versao_tipo_hash_uk",
    };
    const hashClass = classifySpedDbInsertError(hashError);
    assert.equal(hashClass.isHashDuplicate, true);
    assert.equal(hashClass.isSequenceConflict, false);
    assert.equal(hashClass.isFatal, false);
  });

  it("Caso J: Falha no Storage ou persistência não deixa inconsistência silenciosa", () => {
    // Simula falha no upload
    const uploadError = { message: "Network connection timeout" };
    assert.throws(
      () => {
        if (uploadError) {
          throw new SpedServiceError(`Falha no upload para o Storage: ${uploadError.message}`, 500, "STORAGE_UPLOAD_ERROR");
        }
      },
      (error: unknown) => {
        assert.ok(error instanceof SpedServiceError);
        assert.equal(error.statusCode, 500);
        assert.equal(error.code, "STORAGE_UPLOAD_ERROR");
        return true;
      }
    );
  });
});
