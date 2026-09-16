import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("endpoint pesquisa por RPC sem baixar catálogo em lotes", () => {
  const route = readFileSync(new URL("../../app/api/integracoes/mercadolivre/products/route.ts", import.meta.url), "utf8");
  assert.match(route, /rpc\("marketplace_search_products"/);
  assert.doesNotMatch(route, /batchFrom|searchableProducts|matchesProductSearch/);
});
test("contrato SQL pagina e restringe RPC ao servidor", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20260916150000_marketplace_product_search.sql", import.meta.url), "utf8");
  assert.match(sql, /limit p_limit offset/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /l.empresa_id = p_empresa_id/);
});
