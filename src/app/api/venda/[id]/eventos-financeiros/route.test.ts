import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { NextRequest, NextResponse } from "next/server";
import ts from "typescript";
import * as rateio from "@/lib/financeiro/rateio";
import * as bancoLancamento from "@/lib/financeiro/banco-lancamento";

const session = { user: { id: "usuario-autenticado" } };
function loadPost(file: string, supabaseAdmin: unknown, denied?: string) {
  const guard = (name: string) => async () => {
    if (name === denied) throw Object.assign(new Error("Sem permissão"), { statusCode: 403 });
    return session;
  };
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse },
    "@/lib/supabaseAdmin": { supabaseAdmin },
    "@/app/api/_authz/perms": Object.fromEntries(
      ["requireAuthenticated", "requireFinanceirosAccess", "requireVendasAccess", "requireFinanceiroCreate"]
        .map(name => [name, guard(name)]),
    ),
    "@/lib/auth": { auth: async () => session },
    "@/lib/supabase-pagination": {},
    "@/lib/financeiro/eventos-financeiros-selection": { LIMITE_SELECAO_EVENTOS: 500 },
    "@/lib/financeiro/rateio": rateio,
    "@/lib/financeiro/banco-lancamento": bancoLancamento,
    "@/app/api/ordens/[id]/eventos-financeiros/_lib/servico": {
      responderFalha: (error: { message: string; statusCode?: number }) =>
        NextResponse.json({ error: error.message }, { status: error.statusCode ?? 500 }),
    },
  };
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {} as { POST: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response> };
  runInNewContext(code, { exports, require: (name: string) => {
    assert.ok(name in dependencies, `Dependência inesperada: ${name}`);
    return dependencies[name];
  } });
  return exports.POST;
}
const vendaRoute = "src/app/api/venda/[id]/eventos-financeiros/route.ts";
const contexto = { params: Promise.resolve({ id: "150" }) };
const bodyValido = { natureza: "DESPESA", eventoReceitaId: 12479, descricao: " Transportadora ", valor: 65.13 };
const request = (body: unknown) => new NextRequest("https://app.test/api/venda/150/eventos-financeiros", {
  method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
});

test("criação vincula frete à venda da URL e usa o usuário autenticado", async () => {
  let payload: any;
  const post = loadPost(vendaRoute, { rpc: async (name: string, args: unknown) => {
    assert.equal(name, "criar_despesa_frete_venda");
    payload = args;
    return { data: { id: 10 }, error: null };
  } });
  const response = await post(request({ ...bodyValido, vendaId: 999, created_by: "outro" }), contexto);
  assert.equal(response.status, 201);
  assert.equal(payload.p_venda_id, 150);
  assert.equal(payload.p_receita_id, 12479);
  assert.equal(payload.p_usuario, session.user.id);
  assert.equal(payload.p_descricao, "Transportadora");
  assert.deepEqual(await response.json(), { evento: { id: 10 } });
});

for (const permission of ["requireAuthenticated", "requireFinanceirosAccess", "requireVendasAccess", "requireFinanceiroCreate"]) {
  test(`criação exige ${permission} antes de acessar o banco`, async () => {
    const post = loadPost(vendaRoute, {}, permission);
    assert.equal((await post(request(bodyValido), contexto)).status, 403);
  });
}
for (const changes of [{ valor: 0 }, { valor: -1 }, { valor: "NaN" }, { valor: 0.001 }, { descricao: " " }, { eventoReceitaId: null }, { natureza: "RECEITA" }]) {
  test(`rejeita dados inválidos: ${JSON.stringify(changes)}`, async () => {
    const post = loadPost(vendaRoute, {});
    assert.equal((await post(request({ ...bodyValido, ...changes }), contexto)).status, 400);
  });
}
for (const [code, status] of [["P0002", 404], ["22023", 400], ["P0001", 409]] as const) {
  test(`preserva recusa do banco ${code}`, async () => {
    const post = loadPost(vendaRoute, { rpc: async () => ({ data: null, error: { code, message: "Receita inválida" } }) });
    assert.equal((await post(request(bodyValido), contexto)).status, status);
  });
}

for (const [changes, status] of [
  [{}, 201],
  [{ origem: "COMISSAO", is_manual: false }, 201],
  [{ is_manual: false }, 409],
  [{ natureza: "RECEITA" }, 409],
  [{ status: "CONVERTIDO" }, 409],
  [{ origem: "PRODUTO" }, 409],
  [{ source_type: "TRANSACAO" }, 409],
] as const) {
  test(`lançamento financeiro de frete: ${JSON.stringify(changes)} retorna ${status}`, async () => {
    const evento = { id: 10, ordemservicoid: null, source_type: "VENDA", source_id: 150,
      origem: "FRETE", natureza: "DESPESA", status: "ATIVO", is_manual: true,
      pode_gerar_transacao: true, valor: 65.13, descricao: "Frete", ...changes };
    let chamadas = 0;
    const post = loadPost("src/app/api/lancamento-de-eventos/route.ts", {
      from: () => ({ select: () => ({ in: async () => ({ data: [evento], error: null }) }) }),
      rpc: async (_name: string, args: any) => {
        chamadas++;
        assert.equal(args.p_payload.ordemservicoid, null);
        assert.equal(args.p_payload.linhas[0].valor, 65.13);
        return { data: 42, error: null };
      },
    });
    assert.equal((await post(request({ eventosIds: [10], pendente: true, valor: 1 }), contexto)).status, status);
    assert.equal(chamadas, status === 201 ? 1 : 0);
  });
}
