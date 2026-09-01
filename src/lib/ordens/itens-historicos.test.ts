import assert from "node:assert/strict";
import test from "node:test";

import {
  agruparItensHistoricos,
  mapearItemHistorico,
  type ItemHistoricoOs,
} from "./itens-historicos";

function item(id: number, tipo: ItemHistoricoOs["tipo"], subtotal: number): ItemHistoricoOs {
  return { id, tipo, subtotal };
}

test("agrupa uma OS contendo somente produtos historicos", () => {
  const resultado = agruparItensHistoricos([item(1, "PRODUTO", 10), item(2, "PRODUTO", 25)]);
  assert.deepEqual(resultado.produtos.map(({ id }) => id), [1, 2]);
  assert.equal(resultado.servicos.length, 0);
  assert.equal(resultado.totalProdutos, 35);
  assert.equal(resultado.totalServicos, 0);
});

test("agrupa uma OS contendo somente servicos historicos", () => {
  const resultado = agruparItensHistoricos([item(1, "SERVICO", 80)]);
  assert.equal(resultado.produtos.length, 0);
  assert.deepEqual(resultado.servicos.map(({ id }) => id), [1]);
  assert.equal(resultado.totalProdutos, 0);
  assert.equal(resultado.totalServicos, 80);
});

test("separa produtos e servicos e soma cada snapshot uma unica vez", () => {
  const resultado = agruparItensHistoricos([
    item(1, "PRODUTO", 100),
    item(2, "SERVICO", 20),
    item(3, "PRODUTO", 30),
    item(4, "SERVICO", 40),
  ]);
  assert.deepEqual(resultado.produtos.map(({ id }) => id), [1, 3]);
  assert.deepEqual(resultado.servicos.map(({ id }) => id), [2, 4]);
  assert.equal(resultado.totalProdutos, 130);
  assert.equal(resultado.totalServicos, 60);
});

test("considera vazio quando a OS nao possui snapshots", () => {
  const resultado = agruparItensHistoricos(undefined);
  assert.equal(resultado.produtos.length, 0);
  assert.equal(resultado.servicos.length, 0);
  assert.equal(resultado.totalProdutos, 0);
  assert.equal(resultado.totalServicos, 0);
});

test("converte a linha do banco para o contrato usado nos dialogos", () => {
  assert.deepEqual(
    mapearItemHistorico({
      id: "10",
      ordemservicoid: 20,
      linha_origem: 30,
      tipo: "SERVICO",
      codigo_legado: "65",
      descricao: "MÃO DE OBRA",
      unidade: "UN",
      quantidade: "2",
      preco_unitario: "50.5",
      subtotal: "101",
    }),
    {
      id: 10,
      ordemservicoid: 20,
      linhaOrigem: 30,
      tipo: "SERVICO",
      codigoLegado: "65",
      descricao: "MÃO DE OBRA",
      unidade: "UN",
      quantidade: 2,
      precoUnitario: 50.5,
      subtotal: 101,
    },
  );
});
