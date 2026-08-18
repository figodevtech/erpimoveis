import test from "node:test";
import assert from "node:assert/strict";

import { filtroDeBusca } from "./busca";

test("termo vazio nao filtra nada", () => {
  assert.equal(filtroDeBusca(""), null);
  assert.equal(filtroDeBusca("   "), null);
});

test("varre descricao, pagador, classificacao e documento com o mesmo termo", () => {
  const filtro = filtroDeBusca("bosch") ?? "";
  for (const campo of [
    "descricao",
    "descricao_pagamento",
    "nomepagador",
    "cpfcnpjpagador",
    "categoria",
    "plano_de_conta",
    "centro_custo",
    "documento_numero",
    "documento_serie",
    "documento_chave",
    "documento_observacao",
  ]) {
    assert.ok(filtro.includes(`${campo}.ilike.`), `faltou ${campo}`);
  }
});

test("# procura o id e mais nada", () => {
  assert.equal(filtroDeBusca("#87"), "id.eq.87");
  assert.equal(filtroDeBusca("  #87  "), "id.eq.87");
  assert.equal(filtroDeBusca("# 87"), "id.eq.87");
});

test("# com algo que nao e numero cai na busca por texto", () => {
  // Melhor procurar pelo texto do que devolver lista vazia.
  const filtro = filtroDeBusca("#nota") ?? "";
  assert.ok(filtro.includes("descricao.ilike."));
  assert.ok(!filtro.includes("id.eq"));

  assert.ok((filtroDeBusca("#") ?? "").includes("descricao.ilike."));
});

test("# nao aceita numero longo demais para o id", () => {
  const filtro = filtroDeBusca("#" + "3".repeat(44)) ?? "";
  assert.ok(!filtro.includes("id.eq"));
});

test("numero puro tambem procura o id, e por igualdade", () => {
  const filtro = filtroDeBusca("87") ?? "";
  // Igualdade, nao ilike: "87" nao pode trazer #187 e #870 junto.
  assert.ok(filtro.includes("id.eq.87"));
  assert.ok(!filtro.includes("id.ilike"));
});

test("texto nao vira condicao de id", () => {
  assert.ok(!(filtroDeBusca("nota 87") ?? "").includes("id.eq"));
  assert.ok(!(filtroDeBusca("87a") ?? "").includes("id.eq"));
});

test("numero longo demais nao vai para o id", () => {
  // Chave de acesso tem 44 digitos: estourar o bigint derrubaria a consulta.
  const chave = "3".repeat(44);
  assert.ok(!(filtroDeBusca(chave) ?? "").includes("id.eq"));
});

test("documento com pontuacao tambem procura so os digitos", () => {
  const filtro = filtroDeBusca("12.345.678/0001-99") ?? "";
  assert.ok(filtro.includes('cpfcnpjpagador.ilike."*12345678000199*"'));
});

test("termo ja sem pontuacao nao duplica a condicao", () => {
  const filtro = filtroDeBusca("12345678000199") ?? "";
  const ocorrencias = filtro.split("cpfcnpjpagador.ilike").length - 1;
  assert.equal(ocorrencias, 1);
});

test("virgula e aspas nao escapam da expressao do PostgREST", () => {
  // Virgula separa condicoes e aspas delimitam o valor: sem escape, o termo
  // viraria sintaxe e a consulta inteira mudaria de sentido.
  const filtro = filtroDeBusca('a,b"c') ?? "";
  assert.ok(filtro.includes('descricao.ilike."*a,b\\"c*"'));
  // Uma condicao por campo, nenhuma criada pela virgula do usuario. Comparado
  // com um termo inofensivo em vez de um numero fixo, para acrescentar coluna
  // na busca nao quebrar o teste que fala de escape.
  const inofensivo = filtroDeBusca("abc") ?? "";
  assert.equal(
    filtro.split(".ilike.").length,
    inofensivo.split(".ilike.").length,
  );
});

test("barra invertida e neutralizada antes das aspas", () => {
  const filtro = filtroDeBusca('c:\\nota') ?? "";
  assert.ok(filtro.includes('descricao.ilike."*c:\\\\nota*"'));
});
