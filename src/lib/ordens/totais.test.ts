import assert from "node:assert/strict";
import test from "node:test";

import {
  calcularBaseLiquidaDosItens,
  calcularTotaisOs,
  inferirDescontoGeralOs,
} from "./totais";

test("calcula desconto, frete e acrescimo financeiro na ordem correta", () => {
  assert.deepEqual(
    calcularTotaisOs({
      subtotal: 200,
      descontoTipo: "PORCENTAGEM",
      desconto: 10,
      valorFrete: 25,
      acrescimoFinanceiroTipo: "PORCENTAGEM",
      acrescimoFinanceiroValor: 5,
    }),
    {
      subtotal: 200,
      descontoAplicado: 20,
      totalItens: 180,
      valorFrete: 25,
      totalComercial: 205,
      acrescimoFinanceiro: 10.25,
      totalFinanceiro: 215.25,
    },
  );
});

test("frete nao compoe a base liquida dos itens nem o desconto inferido", () => {
  assert.equal(calcularBaseLiquidaDosItens(205, 25), 180);
  assert.equal(
    inferirDescontoGeralOs({ subtotal: 200, orcamentoTotal: 205, valorFrete: 25 }),
    20,
  );
});

test("normaliza entradas invalidas e negativas", () => {
  const totais = calcularTotaisOs({ subtotal: "x", valorFrete: -10 });
  assert.equal(totais.totalComercial, 0);
  assert.equal(totais.totalFinanceiro, 0);
});
