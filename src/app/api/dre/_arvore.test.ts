import assert from "node:assert/strict";
import test from "node:test";
import { montarArvore, type LinhaDre } from "./_arvore";

/**
 * O template real da DRE, reduzido ao que importa para a agregacao: os grupos,
 * seus filhos e o sinal de cada um. Os ids sao os mesmos do banco para o teste
 * ficar comparavel com uma consulta de producao.
 */
const LINHAS = [
  { id: 7, codigo: "1", nome: "RECEITA BRUTA", nivel: 1, parent_id: null, tipo: "GRUPO", sinal: 1 },
  { id: 31, codigo: "1.1", nome: "Produtos", nivel: 2, parent_id: 7, tipo: "DETALHE", sinal: 1 },
  { id: 5, codigo: "1.2", nome: "Servicos", nivel: 2, parent_id: 7, tipo: "DETALHE", sinal: 1 },

  { id: 8, codigo: "2", nome: "DEDUCOES", nivel: 1, parent_id: null, tipo: "GRUPO", sinal: -1 },
  { id: 13, codigo: "2.1", nome: "Impostos", nivel: 2, parent_id: 8, tipo: "DETALHE", sinal: -1 },
  { id: 29, codigo: "2.5", nome: "Descontos", nivel: 2, parent_id: 8, tipo: "DETALHE", sinal: -1 },

  { id: 33, codigo: "3", nome: "RECEITA LIQUIDA", nivel: 1, parent_id: null, tipo: "FORMULA", sinal: 1, formula: "1 - 2" },

  // O grupo que mistura: uma receita e uma despesa dentro do mesmo pai.
  { id: 25, codigo: "10", nome: "RESULTADO FINANCEIRO", nivel: 1, parent_id: null, tipo: "GRUPO", sinal: 1 },
  { id: 20, codigo: "10.1", nome: "Receitas financeiras", nivel: 2, parent_id: 25, tipo: "DETALHE", sinal: 1 },
  { id: 40, codigo: "10.2", nome: "Despesas financeiras", nivel: 2, parent_id: 25, tipo: "DETALHE", sinal: -1 },

  { id: 3, codigo: "9", nome: "RESULTADO OPERACIONAL", nivel: 1, parent_id: null, tipo: "FORMULA", sinal: 1, formula: "7 - 8" },
  { id: 38, codigo: "11", nome: "OUTRAS", nivel: 1, parent_id: null, tipo: "GRUPO", sinal: 1 },
  { id: 32, codigo: "12", nome: "ANTES DOS TRIBUTOS", nivel: 1, parent_id: null, tipo: "FORMULA", sinal: 1, formula: "9 + 10 + 11" },
];

function calcular(valorPorId: Record<number, number>) {
  const soma = new Map(
    Object.entries(valorPorId).map(([id, valor]) => [Number(id), { valor, lancamentos: 1 }]),
  );
  const { plano } = montarArvore(LINHAS, soma, new Map());
  return new Map(plano.map((l: LinhaDre) => [l.codigo, l.valor]));
}

test("grupo de filhos todos positivos soma normalmente", () => {
  const dre = calcular({ 31: 1000, 5: 500 });
  assert.equal(dre.get("1"), 1500);
});

test("grupo de deducoes carrega a magnitude positiva, para a formula subtrair", () => {
  // Os filhos tem sinal -1, mas o grupo precisa valer +180 para que
  // RECEITA LIQUIDA = 1 - 2 chegue em 1320, e nao em 1680.
  const dre = calcular({ 31: 1000, 5: 500, 13: 100, 29: 80 });
  assert.equal(dre.get("2"), 180);
  assert.equal(dre.get("3"), 1320);
});

test("resultado financeiro subtrai a despesa em vez de soma-la", () => {
  // Era o bug: 0,12 + 2223,68 = 2223,80. O correto e a diferenca.
  const dre = calcular({ 20: 0.12, 40: 2223.68 });
  assert.equal(dre.get("10"), -2223.56);
});

test("o erro do resultado financeiro nao vaza para o resultado antes dos tributos", () => {
  const dre = calcular({ 20: 0.12, 40: 2223.68 });
  // 9 vale 0 (sem lancamento), 11 vale 0: o total e o proprio resultado financeiro.
  assert.equal(dre.get("12"), -2223.56);
});

test("resultado financeiro positivo continua positivo", () => {
  const dre = calcular({ 20: 5000, 40: 1200 });
  assert.equal(dre.get("10"), 3800);
});

test("grupo sem lancamento nenhum vale zero, nao NaN", () => {
  const dre = calcular({});
  assert.equal(dre.get("1"), 0);
  assert.equal(dre.get("10"), 0);
  assert.equal(dre.get("12"), 0);
});
