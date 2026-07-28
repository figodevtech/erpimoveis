import assert from "node:assert/strict";
import test from "node:test";

import { matchesFiscalNoteSearch } from "./fiscal-search";

const nota = {
  id: 375,
  modelo: "NF-e",
  numero: 1810,
  chave_acesso: "25260722260069000197550010000018101016777877",
  nsu: "000000000005068",
  destinatarioOuEmitente: {
    nomerazaosocial: "H R COMÉRCIO DE AUTO PEÇAS LTDA",
    cpfcnpj: "22.260.069/0001-97",
  },
};

test("busca nota pelo nome do emissor ignorando acentos", () => {
  assert.equal(matchesFiscalNoteSearch(nota, "comercio auto pecas"), true);
});

test("busca informações fiscais em campos distintos", () => {
  assert.equal(matchesFiscalNoteSearch(nota, "H R 1810 5068"), true);
  assert.equal(matchesFiscalNoteSearch(nota, "22.260.069"), true);
});
