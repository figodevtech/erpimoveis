import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSpedLayout,
  serializeEfd,
  serializeEfdRecord,
  validateSpedCandidate,
  type EfdRecord,
} from "./index";

const layout = resolveSpedLayout("2026-08");

const baseRecords: EfdRecord[] = [
  {
    code: "0000",
    values: {
      COD_VER: "020",
      COD_FIN: "0",
      DT_INI: "2026-08-01",
      DT_FIN: "2026-08-31",
      NOME: "Demir Peças",
      CNPJ: "04252011000110",
      UF: "PB",
      IE: "123",
      COD_MUN: "2507507",
      IND_PERFIL: "B",
      IND_ATIV: "1",
    },
  },
  { code: "0001", values: { IND_MOV: "1" } },
  { code: "0990", values: {} },
];

test("serializa layout 020 com CRLF, Latin-1 e contadores de bloco 9", () => {
  const result = serializeEfd(baseRecords, layout);
  assert.equal(result.layout, "020");
  assert.ok(result.text.endsWith("\r\n"));
  assert.equal(result.text.replace(/\r\n/g, "").includes("\n"), false);
  assert.match(result.text, /\|0990\|3\|\r\n/);
  assert.match(result.text, /\|9900\|9900\|7\|\r\n/);
  assert.equal(result.recordCounts["9900"], 7);
  assert.equal(result.lineCount, 13);
  assert.deepEqual(result.bytes, new Uint8Array([...result.text].map((character) => character.charCodeAt(0))));
});

test("mesmos registros produzem exatamente os mesmos bytes", () => {
  assert.deepEqual(serializeEfd(baseRecords, layout).bytes, serializeEfd(baseRecords, layout).bytes);
});

test("não trunca decimal fiscal com casas significativas excedentes", () => {
  assert.throws(
    () => serializeEfdRecord({ code: "1601", values: { COD_PART_IP: "P1", TOT_VS: "1.001", TOT_ISS: "0", TOT_OUTROS: "0" } }, layout),
    /excede 2 casas/,
  );
  assert.equal(
    serializeEfdRecord({ code: "1601", values: { COD_PART_IP: "P1", TOT_VS: "1.00", TOT_ISS: "0", TOT_OUTROS: "0" } }, layout),
    "|1601|P1||1,00|0,00|0,00|",
  );
});

test("bloqueia gates pendentes e C176/C179 aplicáveis sem registro por documento", () => {
  const pending = validateSpedCandidate({
    competence: "2026-08",
    timezoneIana: "America/Fortaleza",
    gates: {
      profile: "PENDENTE",
      blockK: "NAO_APLICAVEL",
      record1400: "NAO_APLICAVEL",
      recordsC176C179: "CONFIRMADO",
      recordsC176C179Applicable: true,
      record1601: "NAO_APLICAVEL",
      inventory: "NAO_APLICAVEL",
    },
    conditionalEvidence: {
      hasC176C179Evidence: true,
      c176C179Requirements: [{ documentKey: "1".repeat(44), requiredRecords: ["C176"] }],
    },
    records: baseRecords,
  }, layout);
  assert.ok(pending.some((item) => item.code === "PERFIL_EFD_PENDENTE"));
  assert.ok(pending.some((item) => item.code === "REGISTRO_CONDICIONAL_AUSENTE"));
});

test("bloqueia Bloco K obrigatório sem registros de detalhe", () => {
  const diagnostics = validateSpedCandidate({
    competence: "2026-08",
    timezoneIana: "America/Fortaleza",
    gates: {
      profile: "CONFIRMADO",
      blockK: "CONFIRMADO",
      blockKRequired: true,
      record1400: "NAO_APLICAVEL",
      recordsC176C179: "NAO_APLICAVEL",
      record1601: "NAO_APLICAVEL",
      inventory: "NAO_APLICAVEL",
    },
    records: [...baseRecords, { code: "K001", values: { IND_MOV: "1" } }, { code: "K990", values: {} }],
  }, layout);
  assert.ok(diagnostics.some((item) => item.code === "BLOCO_K_REGISTROS_AUSENTES"));
});
