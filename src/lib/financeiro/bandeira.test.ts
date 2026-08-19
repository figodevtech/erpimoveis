import assert from "node:assert/strict";
import test from "node:test";

import {
  calcularPelaFaixa,
  calcularTaxaDaBandeira,
  faixasOrdenadas,
  maximoDeParcelas,
  rotuloDaFaixa,
  taxaDaFaixa,
} from "./bandeira";

/** Tabela de exemplo: uma Visa crédito de adquirente, com as faixas usuais. */
const VISA = [
  { parcelas: 1, taxaPercentual: 3.5 },
  { parcelas: 3, taxaPercentual: 5.2 },
  { parcelas: 6, taxaPercentual: 8.9 },
  { parcelas: 12, taxaPercentual: 14.25 },
];

test("ordena as faixas por número de parcelas", () => {
  const bagunçadas = [
    { parcelas: 6, taxaPercentual: 8.9 },
    { parcelas: 1, taxaPercentual: 3.5 },
    { parcelas: 3, taxaPercentual: 5.2 },
  ];

  assert.deepEqual(
    faixasOrdenadas(bagunçadas).map((faixa) => faixa.parcelas),
    [1, 3, 6],
  );
});

test("faixa repetida fica com a última — é o que o formulário em edição produz", () => {
  const comRepetida = [
    { parcelas: 3, taxaPercentual: 5.2 },
    { parcelas: 3, taxaPercentual: 6.0 },
  ];

  const ordenadas = faixasOrdenadas(comRepetida);
  assert.equal(ordenadas.length, 1);
  assert.equal(ordenadas[0].taxaPercentual, 6.0);
});

test("descarta faixa com parcela ou taxa impossível", () => {
  const comLixo = [
    { parcelas: 0, taxaPercentual: 3 },
    { parcelas: -2, taxaPercentual: 3 },
    { parcelas: 2, taxaPercentual: -1 },
    { parcelas: 4, taxaPercentual: 101 },
    { parcelas: 5, taxaPercentual: 4 },
  ];

  assert.deepEqual(
    faixasOrdenadas(comLixo).map((faixa) => faixa.parcelas),
    [5],
  );
});

test("lista vazia não vira NaN", () => {
  assert.deepEqual(faixasOrdenadas([]), []);
  assert.equal(maximoDeParcelas([]), 0);
});

test("numeric em texto é aceito, com ponto ou com vírgula", () => {
  // O Postgres devolve numeric como string ("5.2000"); o formulário de
  // Configurações manda com vírgula. Os dois precisam chegar na mesma taxa.
  const doBanco = [{ parcelas: "3" as never, taxaPercentual: "5.2000" as never }];
  const daTela = [{ parcelas: 3, taxaPercentual: "5,2" as never }];

  assert.equal(taxaDaFaixa(doBanco, 3), 5.2);
  assert.equal(taxaDaFaixa(daTela, 3), 5.2);
});

test("taxa ilegível derruba a faixa em vez de virar isenção", () => {
  // Zero significaria "esta bandeira não cobra nada" e o lançamento sairia com
  // o líquido cheio sem ninguém perceber.
  const podre = [{ parcelas: 3, taxaPercentual: "cinco" as never }];

  assert.deepEqual(faixasOrdenadas(podre), []);
  assert.equal(taxaDaFaixa(podre, 3), null);
  assert.equal(calcularPelaFaixa(1000, podre, 3), null);
});

test("encontra a taxa da faixa pedida", () => {
  assert.equal(taxaDaFaixa(VISA, 1), 3.5);
  assert.equal(taxaDaFaixa(VISA, 3), 5.2);
  assert.equal(taxaDaFaixa(VISA, 12), 14.25);
});

test("faixa inexistente devolve null, não zero", () => {
  // Zero seria "não cobro nada nessa faixa", que é negociação real no débito.
  // Confundir os dois faria o sistema calcular líquido cheio em um parcelamento
  // que a bandeira nem aceita.
  assert.equal(taxaDaFaixa(VISA, 2), null);
  assert.equal(taxaDaFaixa(VISA, 24), null);

  const isento = [{ parcelas: 1, taxaPercentual: 0 }];
  assert.equal(taxaDaFaixa(isento, 1), 0);
});

test("o máximo é a maior faixa cadastrada", () => {
  assert.equal(maximoDeParcelas(VISA), 12);
  assert.equal(maximoDeParcelas([{ parcelas: 1, taxaPercentual: 2 }]), 1);
});

test("reparte o bruto entre taxa e líquido", () => {
  const { taxa, liquido } = calcularTaxaDaBandeira(1000, 5.2);
  assert.equal(taxa, 52);
  assert.equal(liquido, 948);
});

test("taxa e líquido sempre fecham no bruto", () => {
  // O gatilho transacao_valor_coerente_trg cobra liquido <= bruto a cada escrita:
  // arredondar os dois lados em separado deixaria sobra de centavo.
  for (const bruto of [0.01, 3.33, 99.99, 1234.56, 7777.77]) {
    for (const percentual of [0, 1.99, 3.5, 5.2, 8.9, 14.25, 33.33]) {
      const { taxa, liquido } = calcularTaxaDaBandeira(bruto, percentual);
      assert.equal(
        Math.round(liquido * 100) + Math.round(taxa * 100),
        Math.round(bruto * 100),
        `${bruto} a ${percentual}% não fechou`,
      );
      assert.ok(liquido <= bruto);
      assert.ok(taxa >= 0);
    }
  }
});

test("taxa zero devolve o bruto inteiro", () => {
  const { taxa, liquido } = calcularTaxaDaBandeira(1000, 0);
  assert.equal(taxa, 0);
  assert.equal(liquido, 1000);
});

test("percentual fora da escala é contido, não propagado", () => {
  assert.equal(calcularTaxaDaBandeira(100, 150).taxa, 100);
  assert.equal(calcularTaxaDaBandeira(100, 150).liquido, 0);
  assert.equal(calcularTaxaDaBandeira(100, -10).taxa, 0);
  assert.equal(calcularTaxaDaBandeira(100, -10).liquido, 100);
});

test("bruto ausente, zerado ou lixo não vira NaN", () => {
  for (const bruto of [0, -50, null, undefined, "abc", NaN]) {
    const resultado = calcularTaxaDaBandeira(bruto, 5.2);
    assert.equal(resultado.taxa, 0);
    assert.equal(resultado.liquido, 0);
  }
});

test("arredondamento de centavo não escapa", () => {
  // 333,33 a 3,5% = 11,66655 -> 11,67, e o líquido é a subtração, não outro
  // arredondamento.
  const { taxa, liquido } = calcularTaxaDaBandeira(333.33, 3.5);
  assert.equal(taxa, 11.67);
  assert.equal(liquido, 321.66);
});

test("calcula direto pela tabela da bandeira", () => {
  const resultado = calcularPelaFaixa(1000, VISA, 3);
  assert.deepEqual(resultado, { taxa: 52, liquido: 948, taxaPercentual: 5.2 });
});

test("faixa que a bandeira não oferece devolve null em vez de líquido inventado", () => {
  assert.equal(calcularPelaFaixa(1000, VISA, 2), null);
  assert.equal(calcularPelaFaixa(1000, [], 1), null);
});

test("o rótulo da faixa mostra parcela, percentual e líquido", () => {
  assert.equal(
    rotuloDaFaixa({ parcelas: 3, taxaPercentual: 5.2 }, 1000),
    "3x — 5,20% — líquido R$ 948,00",
  );
});

test("sem bruto informado, o rótulo fica só com o percentual", () => {
  assert.equal(rotuloDaFaixa({ parcelas: 1, taxaPercentual: 3.5 }), "1x — 3,50%");
  assert.equal(rotuloDaFaixa({ parcelas: 1, taxaPercentual: 3.5 }, 0), "1x — 3,50%");
});
