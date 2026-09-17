import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCnpj,
  isValidCnpj,
  normalizeCnpj,
  normalizeFiscalDocument,
} from "./index";

test("preserva e valida CNPJ numérico canônico", () => {
  assert.equal(normalizeCnpj("04.252.011/0001-10"), "04252011000110");
  assert.equal(formatCnpj("04252011000110"), "04.252.011/0001-10");
  assert.equal(isValidCnpj("04.252.011/0001-10"), true);
});

test("preserva, normaliza e formata o primeiro CNPJ alfanumérico oficial", () => {
  assert.equal(normalizeCnpj("00.000.000/e08g-12"), "00000000E08G12");
  assert.equal(formatCnpj("00000000E08G12"), "00.000.000/E08G-12");
  assert.equal(isValidCnpj("00.000.000/E08G-12"), true);
  assert.deepEqual(normalizeFiscalDocument("CNPJ", "00.000.000/e08g-12"), {
    kind: "CNPJ",
    canonical: "00000000E08G12",
    raw: "00.000.000/e08g-12",
  });
});

test("rejeita DV inválido, letra no DV, caracteres desconhecidos e base repetida", () => {
  assert.equal(isValidCnpj("00000000E08G13"), false);
  assert.equal(isValidCnpj("00000000E08G1A"), false);
  assert.equal(isValidCnpj("00000000E08_12"), false);
  assert.equal(isValidCnpj("00000000000000"), false);
});

test("remove somente separadores conhecidos e nunca apaga letras silenciosamente", () => {
  assert.equal(normalizeCnpj("00.000.000/E08G-12"), "00000000E08G12");
  assert.equal(normalizeCnpj("00.000.000/E08G#12"), "00000000E08G#12");
  assert.equal(isValidCnpj("00.000.000/E08G#12"), false);
});
