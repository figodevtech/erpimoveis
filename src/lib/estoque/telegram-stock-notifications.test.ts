import assert from "node:assert/strict";
import test from "node:test";
import { buildStockMovementMessage, type TelegramStockMovement } from "./telegram-stock-notification-format";
import { classifyStockNotificationEvent } from "./telegram-stock-events";

const classifications = [
  ["ENTRADA", "REGISTRO", "ENTRADA", "ENTRADA_REGISTRO"],
  ["ENTRADA", "ESTORNO", "SAIDA", "ENTRADA_ESTORNO"],
  ["SAIDA_MANUAL", "REGISTRO", "SAIDA", "SAIDA_MANUAL_REGISTRO"],
  ["SAIDA_MANUAL", "ESTORNO", "ENTRADA", "SAIDA_MANUAL_ESTORNO"],
  ["VENDA", "REGISTRO", "SAIDA", "VENDA_REGISTRO"],
  ["VENDA", "ESTORNO", "ENTRADA", "VENDA_ESTORNO"],
  ["ORDEM_SERVICO", "REGISTRO", "SAIDA", "ORDEM_SERVICO_REGISTRO"],
  ["ORDEM_SERVICO", "ESTORNO", "ENTRADA", "ORDEM_SERVICO_ESTORNO"],
] as const;

test("classifica as oito movimentações notificáveis do razão", () => {
  for (const [origem, acao, sentido, expected] of classifications) {
    assert.equal(classifyStockNotificationEvent({ origem, acao, sentido }), expected);
  }
});

test("não classifica origem desconhecida nem combinação incoerente", () => {
  assert.equal(classifyStockNotificationEvent({ origem: "NAO_IDENTIFICADA", acao: "REGISTRO", sentido: "SAIDA" }), null);
  assert.equal(classifyStockNotificationEvent({ origem: "VENDA", acao: "REGISTRO", sentido: "ENTRADA" }), null);
});

function movement(overrides: Partial<TelegramStockMovement> = {}): TelegramStockMovement {
  return {
    id: 91,
    produto_id: 7,
    quantidade: 2,
    saldo_anterior: 10,
    saldo_resultante: 8,
    entrada_id: null,
    saida_id: 15,
    venda_id: null,
    ordemservicoid: null,
    documento_label: "Saída #15 - AVARIA",
    observacao: null,
    created_at: "2026-08-15T15:30:00.000Z",
    produto_titulo: "Pastilha <Premium>",
    produto_referencia: "PF&A",
    produto_unidade: "UN",
    entrada_origem: null,
    entrada_fiscal: null,
    entrada_numero_nota: null,
    fornecedor_nome: null,
    saida_motivo: "AVARIA",
    saida_observacao: "Caixa <danificada>",
    criador_nome: "João & Maria",
    ...overrides,
  };
}

test("formata baixa avulsa com produto, quantidade, saldos, motivo e autor", () => {
  const message = buildStockMovementMessage("SAIDA_MANUAL_REGISTRO", movement());
  assert.match(message, /Saída avulsa de estoque/);
  assert.match(message, /Pastilha &lt;Premium&gt;/);
  assert.match(message, /PF&amp;A/);
  assert.match(message, /Quantidade:<\/b> 2 UN/);
  assert.match(message, /Saldo:<\/b> 10 → 8/);
  assert.match(message, /Motivo:<\/b> Avaria/);
  assert.match(message, /João &amp; Maria/);
  assert.match(message, /Caixa &lt;danificada&gt;/);
});

test("formata entrada fiscal com nota e fornecedor", () => {
  const message = buildStockMovementMessage("ENTRADA_REGISTRO", movement({
    entrada_id: 20,
    saida_id: null,
    documento_label: "Entrada #20",
    entrada_origem: "NFE_TERCEIRO",
    entrada_fiscal: true,
    entrada_numero_nota: "1234",
    fornecedor_nome: "Distribuidora A & B",
    saida_motivo: null,
    saida_observacao: null,
  }));
  assert.match(message, /Entrada de estoque/);
  assert.match(message, /Tipo:<\/b> Fiscal/);
  assert.match(message, /Nota:<\/b> 1234/);
  assert.match(message, /Distribuidora A &amp; B/);
});

test("mensagem respeita a margem de segurança do limite do Telegram", () => {
  const message = buildStockMovementMessage("SAIDA_MANUAL_REGISTRO", movement({
    saida_observacao: "x".repeat(5000),
  }));
  assert.ok(message.length <= 4000);
});

