import test from "node:test";
import assert from "node:assert/strict";

import {
  aplicarRecorteDeAutoria,
  decidirRecorte,
  expressaoDeAutoria,
  leApenasMinhas,
  podeAlterarTransacao,
  podeLerTransacao,
} from "./autoria-regra";

const EU = "11111111-1111-1111-1111-111111111111";
const OUTRO = "22222222-2222-2222-2222-222222222222";

const base: Parameters<typeof podeLerTransacao>[0] = {
  podeVerTudo: false,
  usuarioId: EU,
  createdBy: OUTRO,
  documentos: [],
  acessoA: { OS: true, VENDA: true },
};

test("transacao alheia de OS abre para quem acessa OS, mas nao se altera", () => {
  const acesso = { ...base, documentos: ["OS" as const] };
  assert.equal(podeLerTransacao(acesso), true);
  assert.equal(podeAlterarTransacao(acesso), false);
});

test("transacao alheia de venda abre para quem acessa vendas, mas nao se altera", () => {
  const acesso = { ...base, documentos: ["VENDA" as const] };
  assert.equal(podeLerTransacao(acesso), true);
  assert.equal(podeAlterarTransacao(acesso), false);
});

test("o acesso vale por modulo: venda nao abre para quem so acessa OS", () => {
  const acessoA = { OS: true, VENDA: false };
  assert.equal(podeLerTransacao({ ...base, documentos: ["VENDA"], acessoA }), false);
  assert.equal(podeLerTransacao({ ...base, documentos: ["OS"], acessoA }), true);
  // Pagamento multiplo que cobre uma OS e uma venda: basta um dos dois.
  assert.equal(podeLerTransacao({ ...base, documentos: ["OS", "VENDA"], acessoA }), true);
});

test("transacao alheia de OS continua fechada para quem nao acessa OS", () => {
  assert.equal(
    podeLerTransacao({ ...base, documentos: ["OS"], acessoA: { OS: false, VENDA: true } }),
    false,
  );
});

test("transacao alheia fora de OS e de venda nem abre", () => {
  assert.equal(podeLerTransacao(base), false);
  assert.equal(podeAlterarTransacao(base), false);
});

test("sem dono e de todos: abre e altera", () => {
  const acesso = { ...base, createdBy: null };
  assert.equal(podeLerTransacao(acesso), true);
  assert.equal(podeAlterarTransacao(acesso), true);
});

test("a propria transacao abre e altera", () => {
  assert.equal(podeAlterarTransacao({ ...base, createdBy: EU }), true);
});

test("quem ve tudo abre e altera a de qualquer pessoa", () => {
  const acesso = { ...base, podeVerTudo: true };
  assert.equal(podeLerTransacao(acesso), true);
  assert.equal(podeAlterarTransacao(acesso), true);
});

test("sem a permissao o recorte e forcado, com ou sem o parametro", () => {
  assert.deepEqual(decidirRecorte(false, false, EU), { restrito: true, usuarioId: EU });
  assert.deepEqual(decidirRecorte(false, true, EU), { restrito: true, usuarioId: EU });
});

test("com a permissao o recorte so existe se a pessoa pediu", () => {
  assert.deepEqual(decidirRecorte(true, false, EU), { restrito: false, usuarioId: null });
  assert.deepEqual(decidirRecorte(true, true, EU), { restrito: true, usuarioId: EU });
});

test("o que nao tem dono continua visivel para quem esta recortado", () => {
  const expressao = expressaoDeAutoria(EU);
  assert.ok(expressao.includes(`created_by.eq.${EU}`));
  assert.ok(expressao.includes("created_by.is.null"));
});

test("sessao sem id fecha em vez de abrir", () => {
  assert.equal(expressaoDeAutoria(null), "created_by.is.null");
});

test("apenasMinhas aceita as formas que o axios e o fetch produzem", () => {
  for (const valor of ["1", "true", "TRUE", " true "]) {
    assert.equal(leApenasMinhas(valor), true, `deveria aceitar ${JSON.stringify(valor)}`);
  }
  for (const valor of [null, "", "0", "false", "sim"]) {
    assert.equal(leApenasMinhas(valor), false, `deveria recusar ${JSON.stringify(valor)}`);
  }
});

test("consulta sem recorte passa intacta; com recorte ganha um or()", () => {
  const chamadas: string[] = [];
  const consulta = { or: (v: string) => { chamadas.push(v); return consulta; } };

  assert.equal(aplicarRecorteDeAutoria(consulta, { restrito: false, usuarioId: null }), consulta);
  assert.deepEqual(chamadas, []);

  aplicarRecorteDeAutoria(consulta, { restrito: true, usuarioId: EU });
  assert.deepEqual(chamadas, [`created_by.eq.${EU},created_by.is.null`]);
});
