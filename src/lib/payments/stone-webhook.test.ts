import assert from "node:assert/strict";
import test from "node:test";
import { identificadoresStone, statusDoEventoStone } from "./stone-webhook";

test("encontra o pedido mesmo quando o webhook identifica uma charge diferente", () => {
  assert.deepEqual(identificadoresStone({ id: "ch_1", order: { id: "or_1", code: "pedido-1" } }), ["or_1", "pedido-1", "ch_1"]);
  assert.deepEqual(identificadoresStone({ id: "or_1", order: { id: "or_1" } }), ["or_1"]);
});
test("somente eventos explícitos confirmam ou estornam pagamentos", () => {
  assert.equal(statusDoEventoStone("charge.paid"), "PAGO");
  assert.equal(statusDoEventoStone("charge.refunded"), "ESTORNADO");
  assert.equal(statusDoEventoStone("charge.payment_failed"), "RECUSADO");
  assert.equal(statusDoEventoStone("charge.updated"), null);
});
