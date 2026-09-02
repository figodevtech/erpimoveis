import assert from "node:assert/strict";
import test from "node:test";

import { classificarLinhasEntradaHibrida } from "./entrada-fiscal-hibrida";

test("separa linhas normais e personalizadas sem perder centavos", () => {
  const resultado = classificarLinhasEntradaHibrida(
    [
      { numeroItem: 1, custoEstoque: 10.01 },
      { numeroItem: 2, custoEstoque: 20.02 },
      { numeroItem: 3, custoEstoque: 30.03 },
      { numeroItem: 4, custoEstoque: 40.04 },
      { numeroItem: 5, custoEstoque: 50.05 },
    ],
    [1, 2],
  );

  assert.deepEqual(
    resultado.normais.map((linha) => linha.numeroItem),
    [1, 2],
  );
  assert.deepEqual(
    resultado.personalizadas.map((linha) => linha.numeroItem),
    [3, 4, 5],
  );
  assert.equal(resultado.custoNormal, 30.03);
  assert.equal(resultado.custoPersonalizado, 120.12);
  assert.equal(resultado.custoTotal, 150.15);
});

test("aceita todas as linhas em apenas um dos tratamentos", () => {
  const linhas = [
    { numeroItem: 1, custoEstoque: 10 },
    { numeroItem: 2, custoEstoque: 20 },
  ];

  assert.equal(classificarLinhasEntradaHibrida(linhas, []).custoPersonalizado, 30);
  assert.equal(classificarLinhasEntradaHibrida(linhas, [1, 2]).custoNormal, 30);
});

test("recusa numero normal duplicado ou inexistente", () => {
  const linhas = [{ numeroItem: 1, custoEstoque: 10 }];

  assert.throws(
    () => classificarLinhasEntradaHibrida(linhas, [1, 1]),
    /duplicados/,
  );
  assert.throws(
    () => classificarLinhasEntradaHibrida(linhas, [2]),
    /nao existe/,
  );
});
