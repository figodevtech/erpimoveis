import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import ts from "typescript";

const source = readFileSync(path.join(process.cwd(), "src/app/api/dashboard/estoque/route.ts"), "utf8");
const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260928210000_dashboard_estoque_resumo.sql"),
  "utf8",
);
const routeCode = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadRoute(resposta: unknown, { negar = false } = {}) {
  const requests: URL[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    requests.push(new URL(String(input)));
    return Response.json(resposta);
  };
  const supabaseAdmin = createClient("https://dashboard.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  const exports: { GET?: () => Promise<Response> } = {};
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse },
    "@/lib/supabaseAdmin": { supabaseAdmin },
    "@/app/api/_authz/perms": {
      requireDashboardAccess: async () => {
        if (!negar) return;
        const error = new Error("Permissão negada");
        (error as Error & { statusCode: number }).statusCode = 403;
        throw error;
      },
    },
  };
  runInNewContext(routeCode, {
    exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `Dependência inesperada: ${name}`);
      return dependencies[name];
    },
  });
  return { GET: exports.GET!, requests };
}

const RESUMO = {
  totais: {
    produtos: 3,
    unidades: 12,
    valorEstoque: "120.50",
    zerados: 1,
    abaixoMinimo: 1,
    adequados: 1,
    semCusto: 1,
  },
  reposicao: [
    { id: 7, titulo: "Filtro", referencia: null, estoque: 0, minimo: 4, custo: 10, valor: 0, reposicaoSugerida: 4 },
  ],
  maiorValor: [
    { id: 9, titulo: "Pastilha", referencia: "P-1", estoque: 10, minimo: 2, custo: "12.05", valor: "120.50", reposicaoSugerida: 0 },
  ],
};

test("dashboard de estoque vem de uma RPC, sem ler o catalogo", async () => {
  const { GET, requests } = loadRoute(RESUMO);
  const response = await GET();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(requests.map((url) => url.pathname), ["/rest/v1/rpc/dashboard_estoque_resumo"]);
  assert.deepEqual(body.totais, {
    produtos: 3,
    unidades: 12,
    valorEstoque: 120.5,
    zerados: 1,
    abaixoMinimo: 1,
    adequados: 1,
    semCusto: 1,
  });
  assert.deepEqual(body.distribuicao.map((item: { valor: number }) => item.valor), [1, 1, 1]);
  assert.equal(body.reposicao[0].reposicaoSugerida, 4);
  assert.equal(body.maiorValor[0].valor, 120.5);
  assert.equal(body.maiorValor[0].custo, 12.05);
});

test("sem permissao de dashboard continua 403, sem consultar o banco", async () => {
  const { GET, requests } = loadRoute(RESUMO, { negar: true });
  const response = await GET();

  assert.equal(response.status, 403);
  assert.equal(requests.length, 0);
});

test("migration so libera a funcao para service_role", () => {
  assert.match(migration, /revoke all on function public\.dashboard_estoque_resumo\(\) from public, anon, authenticated;/);
  assert.match(migration, /grant execute on function public\.dashboard_estoque_resumo\(\) to service_role;/);
  assert.doesNotMatch(migration.replace(/--[^\n]*/g, ""), /atomic/i);
});
