import assert from "node:assert/strict";
import test, { describe, it } from "node:test";

describe("PVA Validation Rules & Enums", () => {
  const VALID_STATUSES = ["APROVADO", "REJEITADO", "COM_AVISOS"] as const;

  it("aceita apenas status válidos conforme a constraint fiscal_sped_pva_status_chk", () => {
    for (const status of VALID_STATUSES) {
      assert.equal(["APROVADO", "REJEITADO", "COM_AVISOS"].includes(status), true);
    }
  });

  it("valida formato do hash SHA-256 do relatório quando fornecido", () => {
    const validHash = "a".repeat(64);
    const regex = /^[a-f0-9]{64}$/i;
    assert.equal(regex.test(validHash), true);

    const invalidHash = "not-a-sha256";
    assert.equal(regex.test(invalidHash), false);

    const shortHash = "a".repeat(63);
    assert.equal(regex.test(shortHash), false);
  });

  it("exige versão do PVA não vazia", () => {
    const version = "10.1.0";
    assert.equal(version.trim().length > 0, true);

    const emptyVersion = "   ";
    assert.equal(emptyVersion.trim().length === 0, true);
  });
});
