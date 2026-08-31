import assert from "node:assert/strict";
import test from "node:test";

import { ratearCustoPersonalizado } from "./entrada-fiscal-personalizada";

test("rateia o custo consolidado entre uma quantidade diferente da NF-e", () => {
  const rateio = ratearCustoPersonalizado(975.5, 10);

  assert.deepEqual(rateio, {
    custoUnitario: 97.55,
    valorDesconto: 0,
    outrasDespesas: 0,
    custoTotal: 975.5,
  });
});

test("preserva o total em centavos quando quatro casas nao fecham a divisao", () => {
  const rateioComAcrescimo = ratearCustoPersonalizado(100, 300);
  const rateioComDesconto = ratearCustoPersonalizado(100, 398);
  const totalComAcrescimo = Number(
    (
      300 * rateioComAcrescimo.custoUnitario
      - rateioComAcrescimo.valorDesconto
      + rateioComAcrescimo.outrasDespesas
    ).toFixed(2),
  );
  const totalComDesconto = Number(
    (
      398 * rateioComDesconto.custoUnitario
      - rateioComDesconto.valorDesconto
      + rateioComDesconto.outrasDespesas
    ).toFixed(2),
  );

  assert.deepEqual(rateioComAcrescimo, {
    custoUnitario: 0.3333,
    valorDesconto: 0,
    outrasDespesas: 0.01,
    custoTotal: 100,
  });
  assert.deepEqual(rateioComDesconto, {
    custoUnitario: 0.2513,
    valorDesconto: 0.02,
    outrasDespesas: 0,
    custoTotal: 100,
  });
  assert.equal(totalComAcrescimo, 100);
  assert.equal(totalComDesconto, 100);
});

test("recusa quantidade fracionaria, zero e custo negativo", () => {
  assert.throws(() => ratearCustoPersonalizado(100, 1.5), /inteiro maior que zero/);
  assert.throws(() => ratearCustoPersonalizado(100, 0), /inteiro maior que zero/);
  assert.throws(() => ratearCustoPersonalizado(-1, 1), /custo total/);
});
