import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import ts from "typescript";
import * as busca from "@/lib/vendas/busca";
import * as fase from "@/lib/vendas/fase";
import * as apiTiming from "@/lib/api-timing";

const code = ts.transpileModule(readFileSync(path.join(process.cwd(), "src/app/api/venda/route.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadRoute(fetch: typeof globalThis.fetch) {
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse },
    "@/lib/api-timing": apiTiming,
    "@/lib/supabaseAdmin": { supabaseAdmin: createClient("https://vendas.example.test", "test-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch } }) },
    "@/lib/vendas/busca": busca,
    "@/lib/vendas/fase": fase,
    "@/lib/auth": { auth: async () => ({ user: { id: "vendedor-logado" } }) },
    "@/app/api/_authz/perms": { requireVendasAccess: async () => {} },
    "@/lib/movement-authors": { carregarAutores: async () => new Map() },
    "@/lib/integrations/mercadolivre-stock-sync": {},
    "@/lib/ordens/estoque-os": {},
    "@/lib/financeiro/dados-para-financeiro": {},
    "@/lib/vendas/marketplace-buyer-names": { applyMarketplaceBuyerNames: async (items: unknown[]) => items },
  };
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  runInNewContext(code, { exports, URL, console, require: (name: string) => {
    assert.ok(name in dependencies, `Dependência inesperada: ${name}`);
    return dependencies[name];
  } });
  return exports.GET!;
}

test("busca e filtros chegam ao banco antes da paginação, sem cortar os itens retornados", async () => {
  const urls: URL[] = [];
  const GET = loadRoute(async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    return Response.json(url.pathname.endsWith("/venda") ? [{ id: 251, itens: [{ id: 1 }, { id: 2 }], busca_produtos: [{}] }] : [], {
      headers: { "content-range": url.pathname.endsWith("/venda") ? "20-20/21" : "*/0" },
    });
  });
  const params = new URLSearchParams({ search: "11.337.394/0001-94", cliente: "Joao", notaNumero: "123", status: "PAGO", canal: "PDV", valorMin: "100", valorMax: "500", page: "2", limit: "20", dateFrom: "2026-09-01", dateTo: "2026-09-21" });
  const response = await GET(new Request(`https://app.test/api/venda?${params}`));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.pagination.total, 21);
  assert.equal(body.data[0].itens.length, 2);
  assert.equal(body.data[0].busca_produtos, undefined);
  const query = urls[0].searchParams;
  assert.equal(query.get("offset"), "20");
  assert.equal(query.get("status"), "eq.PAGO");
  assert.equal(query.get("canal"), "eq.PDV");
  assert.deepEqual(query.getAll("valortotal"), ["gte.100", "lte.500"]);
  assert.deepEqual(query.getAll("datavenda"), ["gte.2026-09-01T00:00:00.000-03:00", "lte.2026-09-21T23:59:59.999-03:00"]);
  assert.ok(query.getAll("or").includes("(filtro_cliente.not.is.null)"));
  assert.ok(query.getAll("or").includes("(or(filtro_nota.not.is.null,filtro_nota_grupo.not.is.null))"));
  assert.ok(!query.get("busca_nota.or")!.includes("numero.eq."));
  assert.ok(!urls.some((url) => url.pathname.endsWith("/cliente")));
});

test("minhas vendas usa a sessão e combina com entrega", async () => {
  let query: URLSearchParams | undefined;
  const GET = loadRoute(async (input) => { query = new URL(String(input)).searchParams; return Response.json([], { headers: { "content-range": "*/0" } }); });
  const response = await GET(new Request("https://app.test/api/venda?apenasMinhas=1&statusEntrega=ENVIO"));
  assert.equal(response.status, 200);
  assert.equal(query?.get("created_by"), "eq.vendedor-logado");
  assert.equal(query?.get("status_entrega"), "eq.ENVIO");
});

for (const params of ["dateFrom=2026-09-21&dateTo=2026-09-01", "dateFrom=2026-02-30", "valorMin=100&valorMax=10"]) {
  test(`rejeita intervalo inválido: ${params}`, async () => {
    const GET = loadRoute(async () => { throw new Error("Não deveria consultar o banco"); });
    const response = await GET(new Request(`https://app.test/api/venda?${params}`));
    assert.equal(response.status, 400);
  });
}

test("busca longa recebe orientação antes de estourar os cabeçalhos HTTP", async () => {
  const GET = loadRoute(async () => { throw new Error("Não deveria consultar o banco"); });
  const response = await GET(new Request(`https://app.test/api/venda?search=${"aeiou".repeat(20)}`));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /trecho/);
});

test("historico resumido preserva filtros e paginacao sem consultar enriquecimentos financeiros", async () => {
  const urls: URL[] = [];
  const GET = loadRoute(async (input) => {
    const url = new URL(String(input)); urls.push(url);
    assert.equal(url.pathname, "/rest/v1/venda");
    return Response.json([{ id: 7, status: "PAGO", valortotal: 50, busca_produtos: [{}] }], { headers: { "content-range": "0-0/1" } });
  });
  const response = await GET(new Request("https://app.test/api/venda?view=historico&status=PAGO&search=peca&limit=10"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pagination.total, 1);
  assert.equal(body.pagination.limit, 10);
  assert.equal(body.data[0].id, 7);
  assert.equal(body.data[0].busca_produtos, undefined);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].searchParams.get("status"), "eq.PAGO");
  const select = urls[0].searchParams.get("select") ?? "";
  assert.ok(select.includes("busca_produtos:"));
  assert.ok(!select.includes("itens:"));
  assert.ok(!select.includes("transacoes:"));
});

test("aba do historico filtra antes da paginacao e diz o que falta ao pedido do Mercado Livre", async () => {
  const urls: URL[] = [];
  const GET = loadRoute(async (input) => {
    const url = new URL(String(input)); urls.push(url);
    return Response.json([
      { id: 9, status: "FINALIZADA", canal: "MERCADO_LIVRE", status_entrega: "ENVIO", nfe_chave_acesso: null, filtro_fase_nota: [{ id: 3 }], filtro_fase_grupo: [] },
      { id: 8, status: "PAGAMENTO", canal: "PDV", status_entrega: null, nfe_chave_acesso: null, filtro_fase_nota: [], filtro_fase_grupo: [] },
    ], { headers: { "content-range": "0-1/2" } });
  });
  const response = await GET(new Request("https://app.test/api/venda?view=historico&fase=abertas&statusEntrega=ENVIO"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data.map((venda: any) => venda.pendencias_finalizacao), [["ENTREGA"], []]);
  assert.equal(body.data[0].filtro_fase_nota, undefined);
  const query = urls[0].searchParams;
  assert.ok(query.getAll("or").includes(`(${fase.planoFaseVendas("ABERTAS").expressao})`));
  assert.equal(query.get("filtro_fase_nota.or"), "(status.eq.AUTORIZADA)");
  assert.equal(query.get("filtro_fase_grupo.nota.or"), "(status.eq.AUTORIZADA)");
  assert.equal(query.get("status_entrega"), "eq.ENVIO");
  assert.ok((query.get("select") ?? "").includes("filtro_fase_grupo:nfe_origem_vinculo!venda_id(nota:nfe_id!inner(id))"));
});

test("sem aba a lista continua com todas as vendas", async () => {
  let query: URLSearchParams | undefined;
  const GET = loadRoute(async (input) => { query = new URL(String(input)).searchParams; return Response.json([], { headers: { "content-range": "*/0" } }); });
  await GET(new Request("https://app.test/api/venda?view=historico&fase=TODAS"));
  assert.ok(!(query?.get("select") ?? "").includes("filtro_fase_"));
  assert.deepEqual(query?.getAll("or"), []);
});
