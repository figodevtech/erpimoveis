import assert from "node:assert/strict";
import { test } from "node:test";

import {
  excedeLimiteSelecaoDeEventos,
  LIMITE_SELECAO_EVENTOS,
} from "./eventos-financeiros-selection";

test("aceita exatamente 500 eventos numa seleção global", () => {
  assert.equal(LIMITE_SELECAO_EVENTOS, 500);
  assert.equal(excedeLimiteSelecaoDeEventos(500), false);
});

test("recusa 501 eventos sem reduzir a seleção silenciosamente", () => {
  assert.equal(excedeLimiteSelecaoDeEventos(501), true);
});
