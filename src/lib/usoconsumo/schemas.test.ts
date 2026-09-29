import assert from "node:assert/strict";
import test from "node:test";
import { entradaUsoConsumoSchema, usoConsumoItemPatchSchema, zodMessage } from "./schemas";

test("aceita expectedUpdatedAt retornado pelo PostgREST com offset", () => {
  const result = usoConsumoItemPatchSchema.safeParse({
    titulo: "Item atualizado",
    expectedUpdatedAt: "2026-07-29T18:30:00.123+00:00",
  });

  assert.equal(result.success, true);
});

test("continua aceitando expectedUpdatedAt em UTC com sufixo Z", () => {
  const result = usoConsumoItemPatchSchema.safeParse({
    titulo: "Item atualizado",
    expectedUpdatedAt: "2026-07-29T18:30:00.123Z",
  });

  assert.equal(result.success, true);
});

test("rejeita expectedUpdatedAt que não seja uma data válida", () => {
  const result = usoConsumoItemPatchSchema.safeParse({
    titulo: "Item atualizado",
    expectedUpdatedAt: "data-invalida",
  });

  assert.equal(result.success, false);
});

function entradaFiscalCom(itens: Array<Record<string, unknown>>) {
  return {
    fiscal: true,
    origem: "NFE_TERCEIRO",
    fornecedor_id: 1,
    chave_nfe: "25260826535863000157550010000050851162871601",
    documento_fiscal_recebido_id: 257,
    itens,
  };
}

test("quantidade fracionada cita o item da NF-e", () => {
  const input = entradaFiscalCom([
    { item_id: 10, numero_item_fiscal: 5, quantidade: 4, valor_unitario_compra: 8.5 },
    { item_id: 11, numero_item_fiscal: 6, quantidade: 6.15, valor_unitario_compra: 18 },
  ]);
  const result = entradaUsoConsumoSchema.safeParse(input);

  assert.equal(result.success, false);
  assert.equal(
    zodMessage(result.error!, input),
    "Item 6 da NF-e: a quantidade precisa ser um número inteiro.",
  );
});

test("sem número fiscal, o erro do item cita a posição", () => {
  const input = { itens: [{ item_id: 0, quantidade: 1, valor_unitario_compra: 1 }] };
  const result = entradaUsoConsumoSchema.safeParse(input);

  assert.equal(result.success, false);
  assert.equal(zodMessage(result.error!, input), "Item 1: vincule o item ao cadastro.");
});
