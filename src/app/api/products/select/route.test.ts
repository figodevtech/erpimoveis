import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import ts from "typescript";
import * as buscaNumerica from "@/lib/busca-numerica";
import * as productSearch from "@/lib/product-search";

const source = readFileSync(path.join(process.cwd(), "src/app/api/products/select/route.ts"), "utf8");
const routeCode = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const CATALOGO = [
  { id: 4, titulo: "ÓLEO SAE 90 GL-5", fabricante: "LUBRAX", status_estoque: "OK" },
  { id: 3, titulo: "OLEO MOTOR 5W30", fabricante: "MOBIL", status_estoque: "OK" },
  { id: 2, titulo: "OLEO CAMBIO", descricao: "Viscosidade SAE 90", status_estoque: "BAIXO" },
  { id: 1, titulo: "FILTRO DE AR", status_estoque: "OK" },
];

function loadRoute() {
  const requests: URL[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    return Response.json(CATALOGO, { headers: { "content-range": `0-${CATALOGO.length - 1}/${CATALOGO.length}` } });
  };
  const supabaseAdmin = createClient("https://estoque.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse },
    "@/lib/supabaseAdmin": { supabaseAdmin },
    "@/lib/busca-numerica": buscaNumerica,
    "@/lib/product-search": productSearch,
    "@/app/api/_authz/perms": { requireEstoqueAccess: async () => {}, requireEstoqueCreate: async () => {} },
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

async function buscar(params: Record<string, string>) {
  const { GET, requests } = loadRoute();
  const response = await GET(new Request(`https://app.test/api/products/select?${new URLSearchParams(params)}`));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: { id: number }[]; pagination: { total: number } };
  return { ids: body.data.map((item) => item.id), total: body.pagination.total, requests };
}

test("palavras em qualquer ordem e sem acento acham o produto, como na lista", async () => {
  const { ids, total, requests } = await buscar({ search: "oleo 90" });

  assert.deepEqual(ids, [4, 2]);
  assert.equal(total, 2);
  // O filtro por palavra roda na rota: o banco só recebe o recorte de excluídos.
  assert.equal(requests[0]?.searchParams.get("or"), null);
  assert.equal(requests[0]?.searchParams.get("is_deleted"), "eq.false");
});

test("busca por palavras pagina depois de filtrar", async () => {
  const { ids, total } = await buscar({ search: "sae oleo", page: "2", limit: "1" });

  assert.deepEqual(ids, [2]);
  assert.equal(total, 2);
});

test("filtro de status entra na consulta em lotes", async () => {
  const { requests } = await buscar({ search: "oleo 90", status: "BAIXO" });

  assert.equal(requests[0]?.searchParams.get("status_estoque"), "eq.BAIXO");
});

test("numero continua indo direto ao banco", async () => {
  const { requests } = await buscar({ search: "90" });

  const filtro = requests[0]?.searchParams.get("or") ?? "";
  assert.match(filtro, /titulo\.ilike\.%90%/);
  assert.match(filtro, /id\.eq\.90/);
});
