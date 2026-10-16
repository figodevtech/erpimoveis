import assert from "node:assert/strict";
import test from "node:test";
import { ajusteValoresEntradaSchema, ajustesValoresEntradaSchema,
  totalEntradaAjustado, totalItemEntrada } from "./entrada-valores";

test("ajustar um item preserva os acréscimos do cabeçalho e permite restaurar", () => {
  const item = { quantidade: 1, valor_unitario_compra: 500 };
  const diferenca = totalItemEntrada(item, 1500) - totalItemEntrada(item);
  assert.equal(totalEntradaAjustado(530, [diferenca]), 1530);
  assert.equal(totalEntradaAjustado(1530, [-diferenca]), 530);
});

test("recalcula quantidades, descontos e despesas com quatro casas no unitário", () => {
  assert.equal(totalItemEntrada({ quantidade: 3, valor_unitario_compra: 20.1234,
    valor_desconto: 0.01, valor_frete: 2, outras_despesas: 1 }), 63.36);
  assert.equal(totalEntradaAjustado(0.1, [0.2]), 0.3);
});

test("ajuste exige motivo, revisão e IDs distintos sem campos de quantidade", () => {
  const valido = { inventory: "produto", versaoEsperada: 0, motivo: "Custo real",
    itens: [{ id: 1, valorUnitarioCompra: 1500 }] };
  assert.equal(ajusteValoresEntradaSchema.safeParse(valido).success, true);
  assert.equal(ajusteValoresEntradaSchema.safeParse({ ...valido, motivo: " " }).success, false);
  assert.equal(ajusteValoresEntradaSchema.safeParse({ ...valido, versaoEsperada: undefined }).success, false);
  assert.equal(ajusteValoresEntradaSchema.safeParse({ ...valido, itens: [...valido.itens, ...valido.itens] }).success, false);
  for (const valor of [-1, Infinity, NaN, 1.12345, 0.00000001]) {
    assert.equal(ajusteValoresEntradaSchema.safeParse({ ...valido,
      itens: [{ id: 1, valorUnitarioCompra: valor }] }).success, false);
  }
  assert.equal(ajusteValoresEntradaSchema.safeParse({ ...valido,
    itens: [{ ...valido.itens[0], quantidade: 99 }] }).success, false);
});

test("lançamento novo identifica linha fiscal ou consolidada de forma exclusiva", () => {
  const normal = { inventory: "produto", numeroItemFiscal: 1, valorUnitarioCompra: 0 };
  const consolidado = { inventory: "usoconsumo", consolidado: true, valorUnitarioCompra: 2.1234 };
  assert.equal(ajustesValoresEntradaSchema.safeParse({ motivo: "Conferência", itens: [normal, consolidado] }).success, true);
  assert.equal(ajustesValoresEntradaSchema.safeParse({ motivo: "Conferência", itens: [normal, normal] }).success, false);
  assert.equal(ajustesValoresEntradaSchema.safeParse({ motivo: "Conferência",
    itens: [{ ...normal, consolidado: true }] }).success, false);
});
