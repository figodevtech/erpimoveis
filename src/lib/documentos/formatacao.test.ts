import assert from "node:assert/strict";
import test from "node:test";

import { ano, data, dataPorExtenso, moeda, valorPorExtenso } from "./formatacao";

test("valor por extenso: reais e centavos", () => {
  const casos: Array<[number, string]> = [
    [0, "zero reais"],
    [0.01, "um centavo"],
    [0.5, "cinquenta centavos"],
    [1, "um real"],
    [1.01, "um real e um centavo"],
    [2, "dois reais"],
    [15.75, "quinze reais e setenta e cinco centavos"],
    [100, "cem reais"],
    [101, "cento e um reais"],
    [545, "quinhentos e quarenta e cinco reais"],
    [1000, "mil reais"],
    [1001, "mil e um reais"],
    [1100, "mil e cem reais"],
    [1250.5, "mil duzentos e cinquenta reais e cinquenta centavos"],
    [21000, "vinte e um mil reais"],
    [1_000_000, "um milhão de reais"],
    [2_500_000, "dois milhões e quinhentos mil reais"],
    [1_234_567.89, "um milhão duzentos e trinta e quatro mil quinhentos e sessenta e sete reais e oitenta e nove centavos"],
  ];
  for (const [valor, esperado] of casos) assert.equal(valorPorExtenso(valor), esperado, `valor ${valor}`);
});

test("valor por extenso não se perde em ponto flutuante", () => {
  assert.equal(valorPorExtenso(0.1 + 0.2), "trinta centavos");
  assert.equal(valorPorExtenso("316"), "trezentos e dezesseis reais");
});

test("data por extenso, com o primeiro dia ordinal", () => {
  assert.equal(dataPorExtenso("2026-10-14"), "14 de outubro de 2026");
  assert.equal(dataPorExtenso("2026-03-01"), "1º de março de 2026");
  assert.equal(dataPorExtenso(null), "");
});

test("ano no fuso da operação", () => {
  // 01h de 1º de janeiro em UTC ainda é 31 de dezembro em Fortaleza.
  assert.equal(ano(new Date("2027-01-01T01:00:00Z")), "2026");
  assert.equal(ano("2026-10-14"), "2026");
  assert.equal(ano(null), "");
});

test("coluna date não muda de dia; instante cai no dia de Fortaleza", () => {
  assert.equal(data("2026-10-14"), "14/10/2026");
  // 01:00 UTC ainda é dia 13 em Fortaleza (UTC-3).
  assert.equal(data("2026-10-14T01:00:00Z"), "13/10/2026");
  assert.equal(data("lixo"), "");
});

test("moeda em real", () => {
  assert.equal(moeda(1234.5).replace(/\s/g, " "), "R$ 1.234,50");
  assert.equal(moeda(null).replace(/\s/g, " "), "R$ 0,00");
});
