import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SpedServiceError } from "./errors";
import {
  recordSpedFileRegistry,
  shouldCreateNewSpedFile,
  validateSpedFileGenerationPreconditions,
  type StoredSpedFileRecord,
} from "./fileGenerationGuards";

describe("SPED Fiscal — Geração de Arquivos e Idempotência (Casos A, B, C, D, E)", () => {
  const versaoId = 101;
  const hashX = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

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
});
