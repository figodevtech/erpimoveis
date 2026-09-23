import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import ts from "typescript";

/**
 * A trava de `vendas:alterar_vendedor` no PATCH.
 *
 * O que precisa ficar preso por teste: a permissao e exigida pela MUDANCA do
 * vendedor, nao pela presenca do campo. O dialog da venda reenvia `vendedor`
 * inalterado em toda gravacao (venda-detail-dialog.tsx), entao checar presenca
 * barraria qualquer edicao de quem nao tem a permissao — e o campo nem aparece
 * para essa pessoa.
 */

const code = ts.transpileModule(
  readFileSync(path.join(process.cwd(), "src/app/api/venda/[id]/route.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

const VENDEDOR_ATUAL = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OUTRO_VENDEDOR = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function carregarPatch({ temPermissao }: { temPermissao: boolean }) {
  const gravado: Array<Record<string, unknown>> = [];
  const permsExigidas: string[] = [];

  const fetchFalso: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const metodo = (init?.method ?? "GET").toUpperCase();

    if (url.pathname.endsWith("/usuario")) return Response.json([{ id: "editor" }]);

    if (url.pathname.endsWith("/venda") && metodo === "GET") {
      return Response.json([{ id: 7, vendedor: VENDEDOR_ATUAL }]);
    }

    if (url.pathname.endsWith("/venda") && metodo === "PATCH") {
      gravado.push(JSON.parse(String(init?.body ?? "{}")));
      return Response.json([{ id: 7, status: "ABERTA", canal: "PDV", itens: [] }]);
    }

    return Response.json([]);
  };

  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse },
    "@/lib/supabaseAdmin": {
      supabaseAdmin: createClient("https://vendas.example.test", "test-key", {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: fetchFalso },
      }),
    },
    "@/lib/auth": { auth: async () => ({ user: { id: "editor" } }) },
    "@/app/api/_authz/perms": {
      PERMS: { VENDAS_ALTERAR_VENDEDOR: "vendas:alterar_vendedor" },
      requireVendasAccess: async () => {},
      requireVendasEdit: async () => {},
      requireVendasDelete: async () => {},
      requirePerm: async (perm: string) => {
        permsExigidas.push(perm);
        if (!temPermissao) {
          const erro = new Error(`Permissão negada (requer ${perm})`);
          (erro as { statusCode?: number }).statusCode = 403;
          throw erro;
        }
      },
    },
    "@/lib/integrations/mercadolivre-stock-sync": { syncPendingMercadoLivreStock: async () => {} },
    "@/lib/financial-surcharge": {
      calculateFinancialTotal: (v: number) => v,
      sanitizeFinancialSurchargeType: (v: unknown) => v,
    },
    "@/lib/financeiro/dados-para-financeiro": { normalizarDadosParaFinanceiro: (v: unknown) => v },
    "@/lib/payment-methods": {},
  };

  const exports: { PATCH?: (req: unknown, ctx: unknown) => Promise<Response> } = {};
  runInNewContext(code, {
    exports,
    URL,
    console,
    Response,
    require: (nome: string) => {
      assert.ok(nome in dependencies, `Dependência inesperada: ${nome}`);
      return dependencies[nome];
    },
  });

  const chamar = (corpo: Record<string, unknown>) =>
    exports.PATCH!(
      { json: async () => corpo } as unknown,
      { params: Promise.resolve({ id: "7" }) },
    );

  return { chamar, gravado, permsExigidas };
}

test("reenviar o mesmo vendedor nao exige permissao nem regrava o campo", async () => {
  const { chamar, gravado, permsExigidas } = carregarPatch({ temPermissao: false });

  const resposta = await chamar({ vendedor: VENDEDOR_ATUAL, descricao: "ajuste de texto" });

  assert.equal(resposta.status, 200);
  assert.deepEqual(permsExigidas, [], "nao devia ter exigido permissao nenhuma");
  assert.ok(!("vendedor" in gravado[0]), "campo inalterado nao entra no UPDATE");
  assert.equal(gravado[0].descricao, "ajuste de texto", "o resto da edicao passa normalmente");
});

test("trocar o vendedor sem a permissao devolve 403, e nada e gravado", async () => {
  const { chamar, gravado, permsExigidas } = carregarPatch({ temPermissao: false });

  const resposta = await chamar({ vendedor: OUTRO_VENDEDOR });

  assert.equal(resposta.status, 403);
  assert.deepEqual(permsExigidas, ["vendas:alterar_vendedor"]);
  assert.deepEqual(gravado, [], "a venda nao pode ter sido atualizada");
});

test("com a permissao a troca grava o vendedor novo", async () => {
  const { chamar, gravado, permsExigidas } = carregarPatch({ temPermissao: true });

  const resposta = await chamar({ vendedor: OUTRO_VENDEDOR });

  assert.equal(resposta.status, 200);
  assert.deepEqual(permsExigidas, ["vendas:alterar_vendedor"]);
  assert.equal(gravado[0].vendedor, OUTRO_VENDEDOR);
});

test("tirar o vendedor (Sem vendedor) tambem e uma troca", async () => {
  const { chamar, permsExigidas } = carregarPatch({ temPermissao: false });

  const resposta = await chamar({ vendedor: null });

  assert.equal(resposta.status, 403);
  assert.deepEqual(permsExigidas, ["vendas:alterar_vendedor"]);
});
