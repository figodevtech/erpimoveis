import assert from "node:assert/strict";
import test from "node:test";
import {
  entradaUsoConsumoSchema,
  inventarioUsoConsumoSchema,
  saidaUsoConsumoSchema,
  usoConsumoItemCreateSchema,
  usoConsumoItemPatchSchema,
} from "./schemas";

test("cadastra item sem permitir saldo na edição comum", () => {
  assert.equal(usoConsumoItemCreateSchema.safeParse({ titulo: "Bota", estoqueInicial: 3 }).success, true);
  assert.equal(usoConsumoItemCreateSchema.safeParse({ titulo: "", estoqueInicial: 3 }).success, false);
  assert.equal(usoConsumoItemPatchSchema.safeParse({ estoque: 99 }).success, false);
});

test("permite limpar campos opcionais na edição", () => {
  const parsed = usoConsumoItemPatchSchema.parse({ referencia: "", grupo_id: null });
  assert.equal(parsed.referencia, null);
  assert.equal(parsed.grupo_id, null);
  assert.equal(JSON.stringify(parsed), '{"referencia":null,"grupo_id":null}');
});

test("limita alíquotas percentuais", () => {
  assert.equal(usoConsumoItemCreateSchema.safeParse({ titulo: "Bota", aliquotaicms: 100 }).success, true);
  assert.equal(usoConsumoItemCreateSchema.safeParse({ titulo: "Bota", aliquotaicms: 101 }).success, false);
});

test("entrada fiscal exige chave, fornecedor e número dos itens do documento", () => {
  const item = { item_id: 1, quantidade: 3, valor_unitario_compra: 100 };
  assert.equal(entradaUsoConsumoSchema.safeParse({ fiscal: true, origem: "NFE_TERCEIRO", itens: [item] }).success, false);
  assert.equal(entradaUsoConsumoSchema.safeParse({ fiscal: true, origem: "NFE_TERCEIRO", fornecedor_id: 1, chave_nfe: "1".repeat(44), documento_fiscal_recebido_id: 2, itens: [item] }).success, false);
  assert.equal(entradaUsoConsumoSchema.safeParse({ fiscal: true, origem: "NFE_TERCEIRO", fornecedor_id: 1, chave_nfe: "1".repeat(44), documento_fiscal_recebido_id: 2, itens: [{ ...item, numero_item_fiscal: 1 }] }).success, true);
});

test("saída exige motivo e observação quando o motivo é Outro", () => {
  assert.equal(saidaUsoConsumoSchema.safeParse({ motivo: "CONSUMO_INTERNO", itens: [{ item_id: 1, quantidade: 1 }] }).success, true);
  assert.equal(saidaUsoConsumoSchema.safeParse({ motivo: "OUTRO", itens: [{ item_id: 1, quantidade: 1 }] }).success, false);
});

test("inventário exige justificativa e saldo não negativo", () => {
  assert.equal(inventarioUsoConsumoSchema.safeParse({ novo_saldo: 0, observacao: "Contagem física" }).success, true);
  assert.equal(inventarioUsoConsumoSchema.safeParse({ novo_saldo: -1, observacao: "Contagem física" }).success, false);
  assert.equal(inventarioUsoConsumoSchema.safeParse({ novo_saldo: 1, observacao: "x" }).success, false);
});

