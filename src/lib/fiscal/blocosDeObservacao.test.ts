import assert from "node:assert/strict";
import test from "node:test";

import { concatenarBloco } from "./blocosDeObservacao";

test("concatena em nova linha sem alterar o texto existente", () => {
  assert.deepEqual(concatenarBloco("Observação", "Garantia: 90 dias", 500), {
    texto: "Observação\nGarantia: 90 dias",
    truncado: false,
  });
});

test("preserva o conteúdo integral quando ultrapassa o limite", () => {
  const base = "x".repeat(495);
  const resultado = concatenarBloco(base, "Garantia: 90 dias", 500);
  assert.equal(resultado.texto, `${base}\nGarantia: 90 dias`);
  assert.equal(resultado.truncado, true);
});
