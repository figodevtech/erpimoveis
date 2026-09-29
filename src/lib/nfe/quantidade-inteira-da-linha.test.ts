import assert from "node:assert/strict";
import test from "node:test";

import { linhaEmQuantidadeInteira } from "./quantidade-inteira-da-linha";

/** O que a RPC grava: round(qtd * custo, 2) − desconto + outras, em centavos. */
function custoGravadoEmCentavos(linha: ReturnType<typeof linhaEmQuantidadeInteira>) {
  const unitario = Math.round(linha.valorUnitario * 10_000);
  return (
    Math.floor((linha.quantidade * unitario + 50) / 100) -
    Math.round(linha.ajusteDesconto * 100) +
    Math.round(linha.ajusteOutrasDespesas * 100)
  );
}

test("linha inteira passa intacta", () => {
  assert.deepEqual(linhaEmQuantidadeInteira(20, 38), {
    quantidade: 20,
    valorUnitario: 38,
    ajusteDesconto: 0,
    ajusteOutrasDespesas: 0,
  });
});

test("6,15 M a R$ 18 entra como 6 a R$ 18,45, sem mudar o custo", () => {
  const linha = linhaEmQuantidadeInteira(6.15, 18);

  assert.equal(linha.quantidade, 6);
  assert.equal(linha.valorUnitario, 18.45);
  assert.equal(custoGravadoEmCentavos(linha), 11070);
});

test("arredonda para o inteiro mais próximo, com meio para cima", () => {
  assert.equal(linhaEmQuantidadeInteira(2.4, 10).quantidade, 2);
  assert.equal(linhaEmQuantidadeInteira(2.5, 10).quantidade, 3);
  assert.equal(linhaEmQuantidadeInteira(2.6, 10).quantidade, 3);
});

test("abaixo de meia unidade entra como 1, não como 0", () => {
  const linha = linhaEmQuantidadeInteira(0.35, 12);

  assert.equal(linha.quantidade, 1);
  assert.equal(custoGravadoEmCentavos(linha), 420);
});

test("o resíduo da divisão vai para desconto ou outras despesas e o custo fecha", () => {
  const casos: Array<[number, number]> = [
    [2.5, 19.99],
    [3.3333, 7.77],
    [148.75, 3.1415],
    [0.5, 0.01],
    [99.9999, 123.4567],
  ];
  for (const [quantidade, unitario] of casos) {
    const linha = linhaEmQuantidadeInteira(quantidade, unitario);
    assert.equal(
      custoGravadoEmCentavos(linha),
      Math.round(quantidade * unitario * 100),
      `${quantidade} x ${unitario}`,
    );
  }
});
