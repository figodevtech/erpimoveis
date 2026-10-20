import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveSpedLayout, serializeEfd, validateEfdRecords, type EfdRecord } from "@/lib/sped/efd-icms-ipi";
import { isValidCpf } from "@/lib/fiscal-identifiers";

import { PREVIEW_ACCOUNTANT_CPF, withPreviewAccountantPlaceholder } from "./projection";

const base: EfdRecord[] = [
  { code: "0000", values: { COD_VER: "020", COD_FIN: "0", DT_INI: "2026-08-01", DT_FIN: "2026-08-31", NOME: "OFICINA", CNPJ: "11222333000181", UF: "PB", IE: "160000000", COD_MUN: "2507507", IND_PERFIL: "B", IND_ATIV: "1" } },
  { code: "0001", values: { IND_MOV: "0" } },
  { code: "0005", values: { FANTASIA: "OFICINA", CEP: "58000-000", END: "RUA A", NUM: "1", BAIRRO: "CENTRO" } },
  { code: "0150", values: { COD_PART: "P1", NOME: "FORNECEDOR", COD_PAIS: "01058" } },
  { code: "0990", values: {} },
];

describe("contador de marcação na prévia", () => {
  it("entra entre o 0005 e o 0150, marcado como prévia, com CPF de dígitos válidos", () => {
    const records = withPreviewAccountantPlaceholder(base);
    assert.deepEqual(records.map((record) => record.code), ["0000", "0001", "0005", "0100", "0150", "0990"]);
    const values = records[3].values;
    assert.match(String(values.NOME), /PREVIA/);
    assert.equal(values.CPF, PREVIEW_ACCOUNTANT_CPF);
    assert.equal(isValidCpf(PREVIEW_ACCOUNTANT_CPF), true);
    assert.equal(values.COD_MUN, "2507507");
    assert.equal(values.CEP, "58000000");
    assert.match(String(values.EMAIL), /\.invalid$/);
  });

  it("passa nos campos obrigatórios do leiaute e conta no 0990 e no bloco 9", () => {
    const layout = resolveSpedLayout("2026-08");
    const records = withPreviewAccountantPlaceholder(base);
    const missing = validateEfdRecords(records, layout).filter((diagnostic) => diagnostic.record === "0100");
    assert.deepEqual(missing, []);
    const serialized = serializeEfd(records, layout);
    assert.equal(serialized.recordCounts["0100"], 1);
    assert.match(serialized.text, /\|0990\|6\|/);
  });

  it("com contador cadastrado não mexe em nada", () => {
    const withAccountant = [...base.slice(0, 3), { code: "0100", values: { NOME: "MARIA" } }, ...base.slice(3)];
    assert.deepEqual(withPreviewAccountantPlaceholder(withAccountant), withAccountant);
  });
});
