import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildStockOnlyPayload } from "./mercadolivre-stock-payload";
test("estoque simples não envia preço", () => {
  assert.deepEqual(buildStockOnlyPayload(8), { available_quantity: 8 });
  assert.deepEqual(buildStockOnlyPayload(0), { available_quantity: 0 });
});
test("estoque de variação não envia preço", () => {
  assert.deepEqual(buildStockOnlyPayload(5, "123"), { variations: [{ id: 123, available_quantity: 5 }] });
});
test("recusa quantidades e variações inválidas", () => {
  for (const quantity of [-1, NaN, Infinity, 1.5]) assert.throws(() => buildStockOnlyPayload(quantity));
  assert.throws(() => buildStockOnlyPayload(1, "invalid"));
});
test("fila não lê preço do produto nem executa rotinas de preço", () => {
  const source = readFileSync(new URL("./mercadolivre-stock-sync.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /precovenda|startMercadoLivrePriceSyncLog|finishMercadoLivrePriceSyncLog|getMercadoLivrePriceState/);
  assert.match(source, /buildStockOnlyPayload\(quantity, link.ml_variation_id\)/);
});
