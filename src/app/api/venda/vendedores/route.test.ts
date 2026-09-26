import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";

const code = ts.transpileModule(
  readFileSync(path.join(process.cwd(), "src/app/api/venda/vendedores/route.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function carregarRota(permitido: boolean) {
  let consultas = 0;
  const permissoes: string[] = [];
  const query = {
    select: (columns: string) => {
      assert.equal(columns, "id, nome");
      return query;
    },
    eq: (column: string, value: boolean) => {
      assert.equal(column, "ativo");
      assert.equal(value, true);
      return query;
    },
    order: async () => ({ data: [{ id: "seller-id", nome: "Vendedor" }], error: null }),
  };
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse },
    "@/lib/supabaseAdmin": {
      supabaseAdmin: {
        from: (table: string) => {
          assert.equal(table, "usuario");
          consultas++;
          return query;
        },
      },
    },
    "@/app/api/_authz/perms": {
      PERMS: { VENDAS_ALTERAR_VENDEDOR: "vendas:alterar_vendedor" },
      requireVendasEdit: async () => {},
      requirePerm: async (perm: string) => {
        permissoes.push(perm);
        if (!permitido) {
          const error = new Error("Permissao negada");
          (error as Error & { statusCode?: number }).statusCode = 403;
          throw error;
        }
      },
    },
  };
  const exports: { GET?: () => Promise<Response> } = {};
  runInNewContext(code, {
    exports,
    console,
    require: (name: string) => {
      assert.ok(name in dependencies, `Dependencia inesperada: ${name}`);
      return dependencies[name];
    },
  });
  return { get: exports.GET!, permissoes, getConsultas: () => consultas };
}

test("a lista de vendedores exige permissao antes de consultar usuarios", async () => {
  const { get, permissoes, getConsultas } = carregarRota(false);
  const response = await get();
  assert.equal(response.status, 403);
  assert.deepEqual(permissoes, ["vendas:alterar_vendedor"]);
  assert.equal(getConsultas(), 0);
});

test("a lista autorizada retorna apenas id e nome dos usuarios ativos", async () => {
  const { get, getConsultas } = carregarRota(true);
  const response = await get();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { users: [{ id: "seller-id", nome: "Vendedor" }] });
  assert.equal(getConsultas(), 1);
});
