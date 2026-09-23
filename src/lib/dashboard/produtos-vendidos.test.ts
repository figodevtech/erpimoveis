import assert from "node:assert/strict";
import test from "node:test";

import {
  LIMITE_RANKING,
  SEM_GRUPO,
  agregarProdutosVendidos,
  type ItemVendido,
} from "./produtos-vendidos";

function item(parcial: Partial<ItemVendido> = {}): ItemVendido {
  return {
    origem: "VENDA",
    documentoId: 1,
    produtoId: 10,
    titulo: "Óleo 5W30",
    referencia: "OL-5W30",
    unidade: "UN",
    grupoId: 3,
    grupoNome: "Lubrificantes",
    quantidade: 1,
    faturamento: 100,
    ...parcial,
  };
}

test("o mesmo produto vendido pelos dois caminhos vira uma linha só, com a origem separada", () => {
  const { ranking, totais } = agregarProdutosVendidos([
    item({ origem: "VENDA", documentoId: 1, quantidade: 3, faturamento: 300 }),
    item({ origem: "OS", documentoId: 7, quantidade: 2, faturamento: 180 }),
  ]);

  assert.equal(ranking.length, 1);
  assert.deepEqual(ranking[0].venda, { quantidade: 3, faturamento: 300 });
  assert.deepEqual(ranking[0].os, { quantidade: 2, faturamento: 180 });
  assert.equal(ranking[0].quantidade, 5);
  assert.equal(ranking[0].faturamento, 480);

  // As duas origens somadas têm que fechar com o total.
  assert.equal(totais.venda.quantidade + totais.os.quantidade, totais.todas.quantidade);
  assert.equal(totais.venda.faturamento + totais.os.faturamento, totais.todas.faturamento);
});

test("produtos distintos e documentos contam distintos, não linhas", () => {
  const { totais } = agregarProdutosVendidos([
    item({ produtoId: 10, documentoId: 1 }),
    item({ produtoId: 11, documentoId: 1 }),
    item({ produtoId: 10, documentoId: 2 }),
    item({ origem: "OS", produtoId: 12, documentoId: 9 }),
  ]);

  assert.equal(totais.todas.produtosDistintos, 3);
  assert.equal(totais.todas.documentos, 3);
  assert.equal(totais.venda.produtosDistintos, 2);
  assert.equal(totais.venda.documentos, 2);
  assert.equal(totais.os.produtosDistintos, 1);
  assert.equal(totais.os.documentos, 1);
});

test("venda e OS de mesmo número são documentos diferentes no total geral", () => {
  const { totais } = agregarProdutosVendidos([
    item({ origem: "VENDA", documentoId: 7 }),
    item({ origem: "OS", documentoId: 7 }),
  ]);

  assert.equal(totais.todas.documentos, 2);
});

test("quantidade zerada, negativa ou ausente não entra; string do PostgREST entra", () => {
  const { ranking, totais } = agregarProdutosVendidos([
    item({ produtoId: 1, quantidade: 0, faturamento: 999 }),
    item({ produtoId: 2, quantidade: -4, faturamento: 999 }),
    item({ produtoId: 3, quantidade: null, faturamento: 999 }),
    item({ produtoId: 4, quantidade: "3", faturamento: "150.50" }),
  ]);

  assert.equal(ranking.length, 1);
  assert.equal(ranking[0].produtoId, 4);
  assert.equal(ranking[0].quantidade, 3);
  assert.equal(ranking[0].faturamento, 150.5);
  assert.equal(totais.todas.quantidade, 3);
});

test("linha sem produto é descartada", () => {
  const { ranking } = agregarProdutosVendidos([item({ produtoId: null })]);
  assert.deepEqual(ranking, []);
});

test("produto sem título vira o número do cadastro", () => {
  const { ranking } = agregarProdutosVendidos([
    item({ produtoId: 812, titulo: null, referencia: "  ", unidade: null }),
  ]);

  assert.equal(ranking[0].titulo, "Produto #812");
  assert.equal(ranking[0].referencia, null);
  assert.equal(ranking[0].unidade, null);
});

test("empate de quantidade desempata por faturamento e depois pelo id", () => {
  const { ranking } = agregarProdutosVendidos([
    item({ produtoId: 30, quantidade: 5, faturamento: 100 }),
    item({ produtoId: 10, quantidade: 5, faturamento: 100 }),
    item({ produtoId: 20, quantidade: 5, faturamento: 900 }),
    item({ produtoId: 40, quantidade: 9, faturamento: 10 }),
  ]);

  assert.deepEqual(
    ranking.map((produto) => produto.produtoId),
    [40, 20, 10, 30],
  );
});

test("acima do teto o ranking é cortado e avisa", () => {
  const itens = Array.from({ length: LIMITE_RANKING + 5 }, (_, indice) =>
    item({ produtoId: indice + 1, quantidade: indice + 1 }),
  );

  const { ranking, totais, truncado } = agregarProdutosVendidos(itens);

  assert.equal(truncado, true);
  assert.equal(ranking.length, LIMITE_RANKING);
  // O corte é só da lista: os totais continuam contando tudo.
  assert.equal(totais.todas.produtosDistintos, LIMITE_RANKING + 5);
});

test("o grupo vem do cadastro do produto e acompanha a linha do ranking", () => {
  const { ranking } = agregarProdutosVendidos([
    item({ produtoId: 10, grupoId: 3, grupoNome: "Lubrificantes", quantidade: 5 }),
    item({ produtoId: 20, grupoId: 7, grupoNome: "Filtros", quantidade: 2 }),
  ]);

  assert.deepEqual(
    ranking.map((produto) => [produto.produtoId, produto.grupoId, produto.grupoNome]),
    [
      [10, 3, "Lubrificantes"],
      [20, 7, "Filtros"],
    ],
  );
});

test("produto sem grupo no cadastro continua no ranking, rotulado", () => {
  const { ranking } = agregarProdutosVendidos([
    item({ produtoId: 10, grupoId: null, grupoNome: null }),
    item({ produtoId: 20, grupoId: 0, grupoNome: "   " }),
  ]);

  assert.deepEqual(
    ranking.map((produto) => [produto.grupoId, produto.grupoNome]),
    [
      [null, SEM_GRUPO],
      [null, SEM_GRUPO],
    ],
  );
});

test("o grupo é o da primeira linha do produto e não muda a cada item", () => {
  // Duas linhas do mesmo produto sempre trazem o mesmo grupo (é do cadastro);
  // o que importa é que a segunda não sobrescreva nem zere a primeira.
  const { ranking } = agregarProdutosVendidos([
    item({ produtoId: 10, origem: "VENDA", grupoId: 3, grupoNome: "Lubrificantes" }),
    item({ produtoId: 10, origem: "OS", grupoId: 3, grupoNome: "Lubrificantes" }),
  ]);

  assert.equal(ranking.length, 1);
  assert.equal(ranking[0].grupoId, 3);
  assert.equal(ranking[0].grupoNome, "Lubrificantes");
});

test("período sem venda nenhuma devolve zeros, não erro", () => {
  const { ranking, totais, truncado } = agregarProdutosVendidos([]);

  assert.deepEqual(ranking, []);
  assert.equal(truncado, false);
  assert.deepEqual(totais.todas, {
    quantidade: 0,
    faturamento: 0,
    produtosDistintos: 0,
    documentos: 0,
  });
});
