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

test("despesa chama a contraparte de recebedor e receita, de pagador", () => {
  const [despesa] = buildFinancialSummaryMessages("2026-08-12", [transaction()]);
  assert.match(despesa, /Recebedor: Distribuidora ABC/);
  const [receita] = buildFinancialSummaryMessages("2026-08-12", [transaction({ tipo: "RECEITA" })]);
  assert.match(receita, /Pagador: Distribuidora ABC/);
});

test("lançamento sem fornecedor cadastrado usa o nome avulso com o documento", () => {
  const [message] = buildFinancialSummaryMessages("2026-08-12", [
    transaction({ fornecedor: null, nomepagador: "FORTGIRO", cpfcnpjpagador: "12345678000199" }),
  ]);
  assert.match(message, /Recebedor: FORTGIRO · 12\.345\.678\/0001-99/);
  assert.doesNotMatch(message, /Não informado/);
});

test("nome avulso sem documento aparece sozinho", () => {
  const [message] = buildFinancialSummaryMessages("2026-08-12", [
    transaction({ fornecedor: null, nomepagador: "Aluguel do galpão", cpfcnpjpagador: null }),
  ]);
  assert.match(message, /Recebedor: Aluguel do galpão/);
});

test("sem fornecedor e sem nome avulso a conta segue sem dono", () => {
  const [message] = buildFinancialSummaryMessages("2026-08-12", [
    transaction({ fornecedor: null, nomepagador: "   " }),
  ]);
  assert.match(message, /Recebedor: Não informado/);
});

test("resumo de contas a receber usa o próprio título e chama as vencidas pelo nome", () => {
  const [message] = buildFinancialSummaryMessages("2026-08-12", [
    transaction({ tipo: "RECEITA", data: "2026-08-11T12:00:00.000Z", valor: 877.07 }),
  ], "A_RECEBER");
  assert.match(message, /Contas a receber — 12\/08\/2026/);
  assert.match(message, /🔴 Vencidas: <b>1<\/b>/);
  assert.match(message, /877,07/);
  assert.match(message, /<b>VENCIDAS<\/b>/);
  assert.match(message, /Pagador: Distribuidora ABC/);
  assert.doesNotMatch(message, /ATRASADAS/);
});

test("resumo de contas a pagar segue com o título e as palavras de sempre", () => {
  const [message] = buildFinancialSummaryMessages("2026-08-12", [
    transaction({ data: "2026-08-11T12:00:00.000Z" }),
  ]);
  assert.match(message, /Contas a pagar — 12\/08\/2026/);
  assert.match(message, /🔴 Atrasadas: <b>1<\/b>/);
  assert.match(message, /<b>ATRASADAS<\/b>/);
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
