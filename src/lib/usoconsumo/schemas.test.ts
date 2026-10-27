import assert from "node:assert/strict";
import test from "node:test";
import { entradaUsoConsumoSchema, entradaItemSchema, usoConsumoItemPatchSchema, zodMessage } from "./schemas";

test("PATCH de item nao preenche campos omitidos nem aceita atualizacao vazia", () => {
  assert.deepEqual(usoConsumoItemPatchSchema.parse({ titulo: " Teste " }), { titulo: "Teste" });
  assert.equal(usoConsumoItemPatchSchema.safeParse({}).success, false);
});

test("entrada preserva coercao, defaults e mensagens de quantidade/valor invalidos", () => {
  const base = { item_id: "10", quantidade: "2", valor_unitario_compra: "12.50" };
  const valid = entradaItemSchema.parse(base);
  assert.equal(valid.item_id, 10);
  assert.equal(valid.quantidade, 2);
  assert.equal(valid.valor_unitario_compra, 12.5);
  assert.equal(valid.valor_desconto, 0);
  for (const [field, message] of [["quantidade", "quantidade inválida."], ["valor_unitario_compra", "valor unitário inválido."]]) {
    const result = entradaItemSchema.safeParse({ ...base, [field]: "invalido" });
    assert.equal(result.success, false);
    if (!result.success) assert.ok(result.error.issues.some((issue) => issue.message === message));
  }
});

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
