import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPLETED_ORDER_STATUSES,
  dateFallsWithinPeriod,
  summarizeCashFlow,
  summarizeCompletedOrders,
} from "./aggregates";

test("OS concluídas incluem pagamento e concluído, somando quantidade e valor", () => {
  assert.deepEqual(COMPLETED_ORDER_STATUSES, ["PAGAMENTO", "FATURAMENTO", "CONCLUIDO"]);
  assert.deepEqual(summarizeCompletedOrders([
    { orcamentototal: 120.5 },
    { orcamentototal: "79.50" },
  ]), { count: 2, total: 200 });
});

test("fluxo de caixa considera apenas dinheiro efetivamente movimentado em conta", () => {
  assert.deepEqual(summarizeCashFlow([
    { tipo: "RECEITA", valor: 150, valorLiquido: 145, valor_descontos: 5, pendente: false, banco_id: 1 },
    { tipo: "DEPOSITO", valor: 55, valorLiquido: null, valor_descontos: null, pendente: false, banco_id: 1 },
    { tipo: "DESPESA", valor: 80, valorLiquido: null, valor_descontos: null, pendente: false, banco_id: 1 },
    { tipo: "RECEITA", valor: 999, valorLiquido: null, valor_descontos: null, pendente: true, banco_id: null },
  ]), { entries: 200, exits: 80, balance: 120, entryCount: 2, exitCount: 1 });
});

test("vencimentos usam intervalo semiaberto do período", () => {
  const window = { start: "2026-08-24T03:00:00.000Z", end: "2026-08-31T03:00:00.000Z" };
  assert.equal(dateFallsWithinPeriod("2026-08-24T03:00:00.000Z", window), true);
  assert.equal(dateFallsWithinPeriod("2026-08-31T02:59:59.999Z", window), true);
  assert.equal(dateFallsWithinPeriod("2026-08-31T03:00:00.000Z", window), false);
});
