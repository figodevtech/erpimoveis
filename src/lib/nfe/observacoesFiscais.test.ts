import assert from "node:assert/strict";
import test from "node:test";

import { resolverObservacoesFiscais } from "./observacoesFiscais";

test("campo omitido herda integralmente as observações preparadas da origem", () => {
  const origem = "x".repeat(510);
  assert.equal(resolverObservacoesFiscais(undefined, origem), origem);
});

test("null explícito remove as observações herdadas", () => {
  assert.equal(resolverObservacoesFiscais(null, "Garantia: 90 dias"), null);
});

test("texto informado pelo operador vence o texto da origem sem ser cortado", () => {
  const informado = "y".repeat(510);
  assert.equal(resolverObservacoesFiscais(informado, "Garantia: 90 dias"), informado);
});
