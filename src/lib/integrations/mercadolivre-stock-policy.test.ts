import { test } from "node:test";
import assert from "node:assert/strict";
import { assertMercadoLivreItemStockWritable } from "./mercadolivre-stock-policy";
test("bloqueia envio de estoque ERP ao Full", () => {
  assert.throws(() => assertMercadoLivreItemStockWritable({ shipping: { logistic_type: "fulfillment" } }));
});
test("mantém atualização do estoque próprio simples", () => {
  assert.doesNotThrow(() => assertMercadoLivreItemStockWritable({ shipping: { logistic_type: "drop_off" } }));
});
