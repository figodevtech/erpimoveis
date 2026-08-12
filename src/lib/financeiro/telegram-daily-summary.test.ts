import assert from "node:assert/strict";
import test from "node:test";
import { buildFinancialSummaryMessages, fortalezaDateTime, type FinancialTransaction } from "./telegram-daily-summary-format";

function transaction(overrides: Partial<FinancialTransaction> = {}): FinancialTransaction {
  return {
    id: 1,
    descricao: "Compra de peças",
    valor: 150,
    valorLiquido: 0,
    valor_descontos: 0,
    tipo: "DESPESA",
    data: "2026-08-12T12:00:00.000Z",
    categoria: "Fornecedores",
    ordemservicoid: null,
    vendaid: null,
    fornecedor: { nomefantasia: "Distribuidora ABC", nomerazaosocial: null },
    ...overrides,
  };
}

test("fuso de Fortaleza define o dia e horário usados no agendamento", () => {
  assert.deepEqual(fortalezaDateTime(new Date("2026-08-12T11:35:10.000Z")), {
    date: "2026-08-12",
    time: "08:35:10",
  });
});

test("resumo agrupa atrasadas e vencendo hoje e soma os valores", () => {
  const messages = buildFinancialSummaryMessages("2026-08-12", [
    transaction({ id: 1, data: "2026-08-11T12:00:00.000Z", valor: 150 }),
    transaction({ id: 2, data: "2026-08-12T12:00:00.000Z", valor: 350, descricao: "Energia" }),
  ]);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Atrasadas: <b>1<\/b> · R\$ 150,00/);
  assert.match(messages[0], /Vencem hoje: <b>1<\/b> · R\$ 350,00/);
  assert.match(messages[0], /Total geral: <b>R\$ 500,00<\/b>/);
});

test("dados financeiros são escapados antes de enviar HTML ao Telegram", () => {
  const [message] = buildFinancialSummaryMessages("2026-08-12", [
    transaction({ descricao: "Peças <urgentes>", fornecedor: { nomefantasia: "A & B" } }),
  ]);
  assert.match(message, /Peças &lt;urgentes&gt;/);
  assert.match(message, /A &amp; B/);
});

test("lista grande é dividida respeitando o limite do Telegram", () => {
  const transactions = Array.from({ length: 90 }, (_, index) => transaction({
    id: index + 1,
    descricao: `Conta ${index + 1} ${"x".repeat(80)}`,
  }));
  const messages = buildFinancialSummaryMessages("2026-08-12", transactions);
  assert.ok(messages.length > 1);
  assert.ok(messages.every((message) => message.length <= 4096));
  assert.match(messages.at(-1) ?? "", /Parte \d+ de \d+/);
});
