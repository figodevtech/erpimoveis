import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  aplicarRecorteDeAutoria, decidirRecorte, expressaoDeAutoria,
  leApenasMinhas, podeAlterarTransacao, podeLerTransacao,
} from "./autoria-regra";

const EU = "11111111-1111-1111-1111-111111111111";
const ADMIN = "22222222-2222-2222-2222-222222222222";
const ESTOQUE = "33333333-3333-3333-3333-333333333333";
const administrativos = new Set([ADMIN]);
const base: Parameters<typeof podeLerTransacao>[0] = {
  podeVerTudo: false, createdBy: ADMIN, autoresAdministrativos: administrativos,
  documentos: [], acessoA: { OS: true, VENDA: true },
};

test("estoque e financeiro comuns compartilham leitura e operações", () => {
  for (const createdBy of [EU, ESTOQUE, null]) {
    assert.equal(podeLerTransacao({ ...base, createdBy }), true);
    assert.equal(podeAlterarTransacao({ ...base, createdBy }), true);
  }
});

test("caixa administrativo fora de documentos não abre nem altera para usuário comum", () => {
  assert.equal(podeLerTransacao(base), false);
  assert.equal(podeAlterarTransacao(base), false);
});

test("pagamento administrativo de OS abre para quem acessa OS, mas não altera", () => {
  const acesso = { ...base, documentos: ["OS" as const] };
  assert.equal(podeLerTransacao(acesso), true);
  assert.equal(podeAlterarTransacao(acesso), false);
});

test("pagamento administrativo de venda abre para quem acessa vendas, mas não altera", () => {
  const acesso = { ...base, documentos: ["VENDA" as const] };
  assert.equal(podeLerTransacao(acesso), true);
  assert.equal(podeAlterarTransacao(acesso), false);
});

test("exceção de leitura continua específica ao módulo", () => {
  const acessoA = { OS: true, VENDA: false };
  assert.equal(podeLerTransacao({ ...base, documentos: ["VENDA"], acessoA }), false);
  assert.equal(podeLerTransacao({ ...base, documentos: ["OS"], acessoA }), true);
  assert.equal(podeLerTransacao({ ...base, documentos: ["OS", "VENDA"], acessoA }), true);
  assert.equal(podeLerTransacao({ ...base, documentos: ["OS"], acessoA: { OS: false, VENDA: true } }), false);
});

test("administrador abre e altera qualquer transação", () => {
  assert.equal(podeLerTransacao({ ...base, podeVerTudo: true }), true);
  assert.equal(podeAlterarTransacao({ ...base, podeVerTudo: true }), true);
});

test("concessão e remoção da permissão do criador reclassificam o histórico", () => {
  const autores = new Set<string>();
  const acesso = { ...base, createdBy: ESTOQUE, autoresAdministrativos: autores };
  assert.equal(podeAlterarTransacao(acesso), true);
  autores.add(ESTOQUE);
  assert.equal(podeAlterarTransacao(acesso), false);
  autores.delete(ESTOQUE);
  assert.equal(podeAlterarTransacao(acesso), true);
});

test("sem a permissão o recorte é compartilhado e nenhum parâmetro abre tudo", () => {
  for (const apenasMinhas of [false, true]) {
    assert.deepEqual(decidirRecorte(false, apenasMinhas, EU, administrativos), {
      modo: "COMPARTILHADAS", restrito: true, usuarioId: EU, autoresAdministrativos: administrativos,
    });
  }
});

test("administrador escolhe todas ou minhas, separadamente da restrição obrigatória", () => {
  assert.deepEqual(decidirRecorte(true, false, EU, administrativos), { modo: "TODAS", restrito: false, usuarioId: null });
  const minhas = decidirRecorte(true, true, EU, administrativos);
  assert.deepEqual(minhas, { modo: "MINHAS", restrito: true, usuarioId: EU });
  assert.equal(expressaoDeAutoria(minhas), "created_by.eq." + EU + ",created_by.is.null");
});

test("compartilhadas exclui apenas criadores administrativos e inclui sem autor", () => {
  assert.equal(expressaoDeAutoria(decidirRecorte(false, false, EU, administrativos)),
    "created_by.is.null,created_by.not.in.(" + ADMIN + ")");
  assert.equal(expressaoDeAutoria(decidirRecorte(false, false, EU, new Set())), null);
});

test("sessão sem identificador nunca abre a consulta compartilhada", () => {
  assert.equal(expressaoDeAutoria(decidirRecorte(false, false, null, new Set())), "created_by.is.null");
});

test("apenasMinhas aceita as formas de axios e fetch", () => {
  for (const valor of ["1", "true", "TRUE", " true "]) assert.equal(leApenasMinhas(valor), true);
  for (const valor of [null, "", "0", "false", "sim"]) assert.equal(leApenasMinhas(valor), false);
});

test("o builder real mantém busca e visibilidade em AND antes da paginação", async () => {
  let url: URL | undefined;
  const client = createClient("https://caixa.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => { url = new URL(String(input)); return Response.json([]); } },
  });
  const query = client.from("transacao").select("id", { count: "exact" }).or("descricao.ilike.*conta*");
  await aplicarRecorteDeAutoria(query, decidirRecorte(false, false, EU, administrativos)).range(50, 99);
  assert.deepEqual(url!.searchParams.getAll("or"), [
    "(descricao.ilike.*conta*)", "(created_by.is.null,created_by.not.in.(" + ADMIN + "))",
  ]);
  assert.equal(url!.searchParams.get("offset"), "50");
  assert.equal(url!.searchParams.get("limit"), "50");
});
