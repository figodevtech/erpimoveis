import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import ts from "typescript";
import * as productSearch from "@/lib/product-search";

const source = readFileSync(path.join(process.cwd(), "src/app/api/products/route.ts"), "utf8");
const routeCode = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadRoute() {
  const requests: URL[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    requests.push(new URL(String(input)));
    return Response.json([], { headers: { "content-range": "*/0" } });
  };
  const supabaseAdmin = createClient("https://estoque.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse },
    "@/lib/supabaseAdmin": { supabaseAdmin },
    "@/app/api/_authz/perms": { requireEstoqueAccess: async () => {}, requireEstoqueCreate: async () => {} },
    "@/lib/product-search": productSearch,
    "@/services/estoque/entradaService": {},
    "@/lib/auth": {},
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

const produtoRequests = (requests: URL[]) =>
  requests.filter((url) => url.pathname === "/rest/v1/produto");

test("canais marcados viram um filtro por sobreposição no banco, em todas as buscas", async () => {
  // Lista padrão, busca por código (direto no banco) e busca por texto (em lotes).
  for (const search of ["", "123", "oleo filtro"]) {
    const { GET, requests } = loadRoute();
    const query = new URLSearchParams({ canais: "SITE, mercado_livre,AMAZON,SITE" });
    if (search) query.set("search", search);
    const response = await GET(new Request(`https://app.test/api/products?${query}`));
    assert.equal(response.status, 200, `busca "${search}"`);

    const [produto] = produtoRequests(requests);
    assert.ok(produto, `busca "${search}" deveria consultar produto`);
    assert.equal(produto.searchParams.get("canais_anuncio"), "ov.{SITE,MERCADO_LIVRE}", `busca "${search}"`);
  }
});

test("sem canal marcado, a lista não filtra por canal", async () => {
  for (const canais of [null, "", "AMAZON"]) {
    const { GET, requests } = loadRoute();
    const url = canais === null ? "https://app.test/api/products" : `https://app.test/api/products?canais=${canais}`;
    const response = await GET(new Request(url));
    assert.equal(response.status, 200);
    assert.equal(produtoRequests(requests)[0].searchParams.has("canais_anuncio"), false, `canais=${canais}`);
  }
});
