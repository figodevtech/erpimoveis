import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import ts from "typescript";
import * as productSearch from "@/lib/product-search";

// Carrega a rota com autenticação e transporte isolados, sem acessar o banco.
const routeCode = ts.transpileModule(
  readFileSync(path.join(process.cwd(), "src/app/api/pdv/products/route.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function loadRoute(fetch: typeof globalThis.fetch) {
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
  return exports.GET!;
}

for (const search of ["", "oleo", "7891234567890"]) {
  test(`PDV exige visibilidade do produto e do grupo antes de paginar (${search || "listagem"})`, async () => {
    const requests: URL[] = [];
    const GET = loadRoute(async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      return Response.json([
        { id: 2, titulo: "Óleo", codigobarras: "7891234567890", exibirPdv: true, grupo: { id: 1, exibirPdv: true } },
      ], { headers: { "content-range": "0-0/1" } });
    });

    const response = await GET(new Request(`https://app.test/api/pdv/products?q=${search}&limit=1&groupId=1`));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(requests.length, 1);
    const params = requests[0].searchParams;
    // O !inner é necessário: só filtrar a relação deixa o produto na resposta.
    assert.match(params.get("select")!, /grupo:produtogrupo!inner\([^)]*exibirPdv\)/);
    assert.equal(params.get("grupo.exibirPdv"), "eq.true");
    assert.equal(params.get("exibirPdv"), "eq.true");
    assert.equal(params.get("is_deleted"), "eq.false");
    assert.equal(params.get("grupo_produto_id"), "eq.1");
    assert.equal(params.get("limit"), search ? "1000" : "1");
    assert.deepEqual(body.data.map((product: { id: number }) => product.id), [2]);
    assert.equal(body.pagination.total, 1);
    assert.equal(body.pagination.hasNextPage, false);
  });
}

for (const search of ["", "oleo"]) {
  test(`PDV retorna página vazia quando o banco exclui todos os produtos do grupo (${search || "listagem"})`, async () => {
    const GET = loadRoute(async () => Response.json([], {
      headers: { "content-range": "*/0" },
    }));
    const response = await GET(new Request(`https://app.test/api/pdv/products?q=${search}&groupId=2`));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.data, []);
    assert.equal(body.pagination.total, 0);
    assert.equal(body.pagination.totalPages, 1);
    assert.equal(body.pagination.hasNextPage, false);
  });
}
