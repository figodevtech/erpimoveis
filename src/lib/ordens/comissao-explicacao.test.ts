import assert from "node:assert/strict";
import test from "node:test";

import { explicarBaseDaComissao } from "./comissao-explicacao";

test("serviço inteiro para uma pessoa não tem o que explicar", () => {
  const explicacao = explicarBaseDaComissao({
    subtotalServico: 1800,
    valorBase: 1800,
    realizadores: 1,
  });

  assert.equal(explicacao.dividido, false);
  assert.equal(explicacao.descontoAplicado, false);
  assert.equal(explicacao.texto, "");
});

test("dividido entre dois, sem desconto", () => {
  const explicacao = explicarBaseDaComissao({
    subtotalServico: 1000,
    valorBase: 500,
    realizadores: 2,
  });

  assert.equal(explicacao.dividido, true);
  assert.equal(explicacao.descontoAplicado, false);
  assert.equal(explicacao.texto, "1/2 do serviço");
});

test("desconto da OS encolhe a base de um realizador só", () => {
  // OS #248 do Demir: R$ 200 de desconto sobre R$ 10.580 em itens.
  const explicacao = explicarBaseDaComissao({
    subtotalServico: 1800,
    valorBase: 1765.97,
    realizadores: 1,
  });

  assert.equal(explicacao.dividido, false);
  assert.equal(explicacao.descontoAplicado, true);
  assert.equal(explicacao.texto, "já com o desconto da OS");
});

test("divisão e desconto juntos aparecem na mesma frase", () => {
  const explicacao = explicarBaseDaComissao({
    subtotalServico: 1000,
    valorBase: 450,
    realizadores: 2,
  });

  assert.equal(explicacao.texto, "1/2 do serviço, já com o desconto da OS");
});

test("arredondamento por realizador não vira desconto", () => {
  // 333,33 x 3 = 999,99: um centavo abaixo, e não há desconto nenhum.
  const explicacao = explicarBaseDaComissao({
    subtotalServico: 1000,
    valorBase: 333.33,
    realizadores: 3,
  });

  assert.equal(explicacao.descontoAplicado, false);
  assert.equal(explicacao.texto, "1/3 do serviço");
});

test("serviço sem valor não inventa desconto", () => {
  const explicacao = explicarBaseDaComissao({
    subtotalServico: 0,
    valorBase: 0,
    realizadores: 1,
  });

  assert.equal(explicacao.descontoAplicado, false);
  assert.equal(explicacao.texto, "");
});

test("entradas inválidas caem para um realizador", () => {
  const explicacao = explicarBaseDaComissao({
    subtotalServico: Number.NaN,
    valorBase: Number.NaN,
    realizadores: 0,
  });

  assert.equal(explicacao.realizadores, 1);
  assert.equal(explicacao.texto, "");
});
