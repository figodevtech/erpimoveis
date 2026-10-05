import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { NextRequest, NextResponse } from "next/server";
import ts from "typescript";
import * as rateio from "@/lib/financeiro/rateio";
import * as bancoLancamento from "@/lib/financeiro/banco-lancamento";
import * as documentoEvento from "@/lib/financeiro/documento-evento";
import * as exclusaoEvento from "@/lib/ordens/exclusao-evento-financeiro";
import * as competencia from "@/app/api/ordens/[id]/eventos-financeiros/_lib/competencia";

const session = { user: { id: "usuario-autenticado" } };
function loadPost(file: string, supabaseAdmin: unknown, denied?: string, metodo = "POST") {
  const guard = (name: string) => async () => {
    if (name === denied) throw Object.assign(new Error("Sem permissão"), { statusCode: 403 });
    return session;
  };
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse },
    "@/lib/supabaseAdmin": { supabaseAdmin },
    "@/app/api/_authz/perms": Object.fromEntries(
      ["requireAuthenticated", "requireFinanceirosAccess", "requireVendasAccess", "requireFinanceiroCreate", "requireFinanceiroEdit", "requireFinanceiroDelete"]
        .map(name => [name, guard(name)]),
    ),
    "@/lib/auth": { auth: async () => session },
    "@/lib/supabase-pagination": {},
    "@/lib/financeiro/eventos-financeiros-selection": { LIMITE_SELECAO_EVENTOS: 500 },
    "@/lib/financeiro/rateio": rateio,
    "@/lib/financeiro/banco-lancamento": bancoLancamento,
    "@/lib/financeiro/documento-evento": documentoEvento,
    "@/lib/ordens/exclusao-evento-financeiro": exclusaoEvento,
    "@/app/api/ordens/[id]/eventos-financeiros/_lib/competencia": competencia,
    "@/app/api/ordens/[id]/eventos-financeiros/_lib/servico": {
      idValido: (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null,
      editarEventoDaOs: async () => ({ ok: true, corpo: { evento: { id: 10, ordemservicoid: 9 } } }),
      responder: (resultado: { ok: boolean; corpo?: unknown; error?: string; status?: number }, status = 200) =>
        NextResponse.json(resultado.ok ? resultado.corpo : { error: resultado.error }, {
          status: resultado.ok ? status : resultado.status,
        }),
      responderFalha: (error: { message: string; statusCode?: number }) =>
        NextResponse.json({ error: error.message }, { status: error.statusCode ?? 500 }),
    },
  };
  const loadModule = (path: string) => {
    const code = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports: Record<string, any> = {};
    runInNewContext(code, { exports, require: (name: string) => {
      assert.ok(name in dependencies, `Dependência inesperada: ${name}`);
      return dependencies[name];
    } });
    return exports;
  };
  // O serviço real usa o mesmo banco isolado; os testes percorrem o caminho
  // da rota até a RPC sem copiar suas regras nem abrir uma conexão externa.
  dependencies["@/lib/financeiro/eventos-documento"] = loadModule("src/lib/financeiro/eventos-documento.ts");
  dependencies["@/lib/financeiro/eventos-autoria"] = loadModule("src/lib/financeiro/eventos-autoria.ts");
  return loadModule(file)[metodo] as (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
}
const vendaRoute = "src/app/api/venda/[id]/eventos-financeiros/route.ts";
const contexto = { params: Promise.resolve({ id: "150" }) };
const bodyValido = { natureza: "DESPESA", eventoReceitaId: 12479, descricao: " Transportadora ", valor: 65.13 };
const bodyAvulso = { modalidade: "AVULSO", natureza: "DESPESA", tipo: "PRODUTO", descricao: " Custo complementar ", detalhe: " Ajuste ", valor: 20 };
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

const edicaoRoute = "src/app/api/eventos-financeiros/[eventoId]/route.ts";
const contextoEdicao = { params: Promise.resolve({ eventoId: "10" }) };
function bancoEdicao(rpc: (name: string, args: any) => Promise<unknown>, documento = { ordemservicoid: null as number | null, source_type: "VENDA", source_id: 150 }) {
  const consulta = { select: () => consulta, eq: () => consulta, maybeSingle: async () => ({ data: documento, error: null }) };
  return { from: () => consulta, rpc };
}

test("PATCH resolve venda real, usa a RPC de edição e ignora autor/documento forjados", async () => {
  const patch = loadPost(edicaoRoute, bancoEdicao(async (name, args) => {
    assert.equal(name, "editar_evento_financeiro_venda");
    assert.equal(args.p_venda_id, 150);
    assert.equal(args.p_evento_id, 10);
    assert.equal(args.p_usuario, session.user.id);
    assert.equal(args.p_payload.valor, 55.13);
    assert.equal(args.p_payload.descricao, "Corrigido");
    assert.equal(args.p_payload.detalhe, null);
    assert.equal(args.p_payload.natureza, undefined);
    return { data: { id: 10, valor: 55.13, competencia_em: "2000-01-01" }, error: null };
  }), undefined, "PATCH");
  const response = await patch(request({ valor: 55.13, descricao: "Corrigido", detalhe: null, usuarioId: "forjado", vendaId: 999, natureza: "RECEITA" }), contextoEdicao);
  assert.equal(response.status, 200);
  assert.match((await response.json()).aviso, /DRE.*recalculada/);
});

for (const denied of ["requireFinanceiroEdit", "requireVendasAccess", "requireFinanceirosAccess"]) {
  test(`PATCH exige ${denied} antes de alterar o banco`, async () => {
    const patch = loadPost(edicaoRoute, bancoEdicao(async () => { assert.fail("Não pode editar sem permissão"); }), denied, "PATCH");
    assert.equal((await patch(request({ valor: 20 }), contextoEdicao)).status, 403);
  });
}
for (const body of [null, [], {}, { valor: null }, { valor: "" }, { valor: true }, { valor: -1 }, { valor: "Infinity" }]) {
  test(`PATCH rejeita valor/payload inválido: ${JSON.stringify(body)}`, async () => {
    const patch = loadPost(edicaoRoute, bancoEdicao(async () => { assert.fail("Não pode chamar RPC para valor inválido"); }), undefined, "PATCH");
    assert.equal((await patch(request(body), contextoEdicao)).status, 400);
  });
}
for (const [code, status] of [["P0001", 409], ["P0002", 404], ["22023", 400]] as const) {
  test(`PATCH preserva bloqueios da RPC ${code}`, async () => {
    const patch = loadPost(edicaoRoute, bancoEdicao(async () => ({ data: null, error: { code, message: "Recusa financeira" } })), undefined, "PATCH");
    const response = await patch(request({ valor: 20 }), contextoEdicao);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: "Recusa financeira" });
  });
}
test("PATCH de OS continua delegando ao serviço original", async () => {
  const patch = loadPost(edicaoRoute, bancoEdicao(async () => { assert.fail("Não pode usar RPC de venda para OS"); },
    { ordemservicoid: 9, source_type: "ORDEM_SERVICO", source_id: 9 }), undefined, "PATCH");
  const response = await patch(request({ valor: 20 }), contextoEdicao);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).evento.ordemservicoid, 9);
});

for (const [tipo, natureza] of [
  ["PRODUTO", "RECEITA"], ["PRODUTO", "DESPESA"],
  ["SERVICO", "RECEITA"], ["SERVICO", "DESPESA"], ["CONSUMO", "DESPESA"],
]) {
  test(`criação avulsa ${tipo}/${natureza} usa a RPC manual, a venda da URL e o autor autenticado`, async () => {
    let chamadas = 0;
    const post = loadPost(vendaRoute, { rpc: async (name: string, args: any) => {
      chamadas++;
      assert.equal(name, "criar_evento_financeiro_manual_venda");
      assert.equal(args.p_venda_id, 150);
      assert.equal(args.p_usuario, session.user.id);
      assert.equal(args.p_tipo, tipo);
      assert.equal(args.p_natureza, natureza);
      assert.equal(args.p_valor, 20);
      assert.equal(args.p_descricao, bodyAvulso.descricao);
      assert.equal(args.p_detalhe, bodyAvulso.detalhe);
      return { data: { id: 13 }, error: null };
    } });
    const response = await post(request({ ...bodyAvulso, tipo, natureza, vendaId: 999, created_by: "outro" }), contexto);
    assert.equal(response.status, 201);
    assert.equal(chamadas, 1);
    assert.deepEqual(await response.json(), { evento: { id: 13 } });
  });
}

test("modalidade explícita de frete mantém a RPC vinculada", async () => {
  const post = loadPost(vendaRoute, { rpc: async (name: string) => {
    assert.equal(name, "criar_despesa_frete_venda");
    return { data: { id: 10 }, error: null };
  } });
  assert.equal((await post(request({ ...bodyValido, modalidade: "DESPESA_FRETE" }), contexto)).status, 201);
});

for (const body of [
  null, {}, { ...bodyAvulso, modalidade: "OUTRO" },
  { ...bodyAvulso, eventoReceitaId: 12479 }, { ...bodyAvulso, eventoReceitaServicoId: 12479 },
]) {
  test(`modalidade inválida ou ambígua não acessa o banco: ${JSON.stringify(body)}`, async () => {
    assert.equal((await loadPost(vendaRoute, {})(request(body), contexto)).status, 400);
  });
}

for (const permission of ["requireAuthenticated", "requireFinanceirosAccess", "requireVendasAccess", "requireFinanceiroCreate"]) {
  test(`criação exige ${permission} antes de acessar o banco`, async () => {
    const post = loadPost(vendaRoute, {}, permission);
    assert.equal((await post(request(bodyValido), contexto)).status, 403);
  });
  test(`criação avulsa exige ${permission} antes de acessar o banco`, async () => {
    const post = loadPost(vendaRoute, {}, permission);
    assert.equal((await post(request(bodyAvulso), contexto)).status, 403);
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
  test(`criação avulsa preserva recusa da RPC ${code}`, async () => {
    const post = loadPost(vendaRoute, { rpc: async () => ({ data: null, error: { code, message: "Evento inválido" } }) });
    const response = await post(request(bodyAvulso), contexto);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: "Evento inválido" });
  });
}

for (const [changes, status] of [
  [{}, 201],
  [{ origem: "COMISSAO", is_manual: false }, 201],
  [{ is_manual: false }, 409],
  [{ natureza: "RECEITA" }, 409],
  [{ status: "CONVERTIDO" }, 409],
  [{ origem: "PRODUTO" }, 201],
  [{ origem: "SERVICO" }, 201],
  [{ origem: "CONSUMO" }, 201],
  [{ origem: "PRODUTO", is_manual: false, pode_gerar_transacao: false }, 409],
  [{ chave_origem: "FRETE" }, 409],
  [{ pode_gerar_transacao: false }, 409],
  [{ source_id: null }, 409],
  [{ transacaoid: 20 }, 409],
  [{ lancamento_id: 20 }, 409],
  [{ source_type: "TRANSACAO" }, 409],
] as const) {
  test(`lançamento de despesas da venda: ${JSON.stringify(changes)} retorna ${status}`, async () => {
    const evento = { id: 10, ordemservicoid: null, source_type: "VENDA", source_id: 150,
      origem: "FRETE", natureza: "DESPESA", status: "ATIVO", is_manual: true,
      chave_origem: "MANUAL:8f96b1da-60c4-478b-8c72-9c9fb783c403",
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
