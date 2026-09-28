import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import ts from "typescript";
import * as productSearch from "@/lib/product-search";

const source = readFileSync(path.join(process.cwd(), "src/app/api/pdv/products/route.ts"), "utf8");
const migration = readFileSync(path.join(process.cwd(), "supabase/migrations/20260928185708_pdv_product_search.sql"), "utf8");
const routeCode = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

type RpcRequest = { url: URL; body: Record<string, unknown> };

function loadRoute(result: { data: unknown[]; total: number }) {
  const requests: RpcRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), body: JSON.parse(String(init?.body)) });
    return Response.json(result);
  };
  const supabaseAdmin = createClient("https://pdv.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse },
    "@/lib/supabaseAdmin": { supabaseAdmin },
    "@/app/api/_authz/perms": { requireVendasAccess: async () => {} },
    "@/lib/product-search": productSearch,
  };
  runInNewContext(routeCode, {
    exports,
    URL,
    require: (name: string) => {
      assert.ok(name in dependencies, `Dependência inesperada: ${name}`);
      return dependencies[name];
    },
  });
  return { GET: exports.GET!, requests };
}

test("busca sem acento usa uma RPC paginada, inclusive para módulo", async () => {
  for (const [query, expected] of [["oleo", "oleo"], ["módulo", "modulo"]]) {
    const { GET, requests } = loadRoute({ data: [{ id: 2, titulo: "Óleo / módulo" }], total: 1 });
    const response = await GET(new Request(`https://app.test/api/pdv/products?q=${encodeURIComponent(query)}`));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url.pathname, "/rest/v1/rpc/pdv_search_products");
    assert.equal(JSON.stringify(requests[0].body.p_tokens), JSON.stringify([{ value: expected, structured: false }]));
    assert.equal(requests[0].body.p_limit, 48);
    assert.equal(body.data[0].titulo, "Óleo / módulo");
  }
  assert.match(migration, /marketplace_search_normalize\(v_token->>'value'\)/);
  assert.match(migration, /pdv_product_search_text\(p\) like/);
  assert.match(migration, /gin_trgm_ops/);
});

test("paginação, grupo e status são enviados ao banco e o total é preservado", async () => {
  const { GET, requests } = loadRoute({ data: [{ id: 6 }, { id: 5 }], total: 7 });
  const response = await GET(new Request("https://app.test/api/pdv/products?page=2&limit=2&groupId=3&status=BAIXO"));
  const body = await response.json();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.p_page, 2);
  assert.equal(requests[0].body.p_limit, 2);
  assert.equal(requests[0].body.p_group_id, 3);
  assert.equal(requests[0].body.p_status, "BAIXO");
  assert.deepEqual(body.data, [{ id: 6 }, { id: 5 }]);
  assert.equal(body.pagination.total, 7);
  assert.equal(body.pagination.totalPages, 4);
  assert.equal(body.pagination.hasNextPage, true);
  assert.deepEqual(body.filters, { search: "", groupId: 3 });
});

test("limite máximo é 100 e página vazia mantém metadados corretos", async () => {
  const { GET, requests } = loadRoute({ data: [], total: 0 });
  const body = await (await GET(new Request("https://app.test/api/pdv/products?search=de&limit=1000&page=3"))).json();
  assert.equal(requests[0].body.p_limit, 100);
  assert.equal(JSON.stringify(requests[0].body.p_tokens), JSON.stringify([{ value: "de", structured: false }]));
  assert.equal(body.pagination.total, 0);
  assert.equal(body.pagination.totalPages, 1);
  assert.equal(body.pagination.hasNextPage, false);
});

test("a seleção, filtros e limite acontecem no SQL, sem lotes de 1000", () => {
  assert.doesNotMatch(source, /\.select\(|\.range\(|batchSize|select\s*=\s*['"]\*/);
  assert.match(migration, /p\.is_deleted = false and p\."exibirPdv" = true and g\."exibirPdv" = true/);
  assert.match(migration, /limit %s offset %s/);
  assert.match(migration, /p_limit > 100/);
  assert.match(migration, /jsonb_agg\(to_jsonb\(r\)/);
  assert.doesNotMatch(migration, /select\s+p\.\*/i);
});
