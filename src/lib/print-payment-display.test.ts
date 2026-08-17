import assert from "node:assert/strict";
import test from "node:test";

import { buildPrintPaymentSummary } from "./print-payment-display";

test("OS aberta exibe as formas previstas com valores e parcelas", () => {
  const summary = buildPrintPaymentSummary({
    type: "OS",
    status: "PAGAMENTO",
    pagamentosPrevistos: [
      { metodo: "PIX", valor: 400 },
      { metodo: "CREDITO", valor: 600, parcelas: 3 },
    ],
  });

  assert.equal(summary?.kind, "PREVISTO");
  assert.deepEqual(
    summary?.entries.map(({ metodo, valor, parcelas }) => ({ metodo, valor, parcelas })),
    [
      { metodo: "PIX", valor: 400, parcelas: null },
      { metodo: "CREDITO", valor: 600, parcelas: 3 },
    ],
  );
});

test("OS concluida usa os pagamentos registrados e agrupa o mesmo metodo", () => {
  const summary = buildPrintPaymentSummary({
    type: "OS",
    status: "CONCLUIDO",
    pagamentosPrevistos: [{ metodo: "BOLETO", valor: 1_000 }],
    recordedPayments: [
      { metodo: "PIX", valor: 350 },
      { metodo: "PIX", valor: 150 },
      { metodo: "DEBITO", valor: 500 },
    ],
  });

  assert.equal(summary?.kind, "REALIZADO");
  assert.deepEqual(
    summary?.entries.map(({ metodo, valor }) => ({ metodo, valor })),
    [
      { metodo: "PIX", valor: 500 },
      { metodo: "DEBITO", valor: 500 },
    ],
  );
});

test("venda finalizada nao reaproveita previsao quando nao ha baixa", () => {
  const summary = buildPrintPaymentSummary({
    type: "VENDA",
    status: "FINALIZADA",
    pagamentosPrevistos: [{ metodo: "CREDITO", valor: 250, parcelas: 2 }],
    recordedPayments: [],
  });

  assert.equal(summary, null);
});

test("documento cancelado ou sem cobranca nao mostra previsao", () => {
  assert.equal(
    buildPrintPaymentSummary({
      type: "OS",
      status: "SEM_COBRANCA",
      formaPagamento: "DINHEIRO",
    }),
    null,
  );
  assert.equal(
    buildPrintPaymentSummary({
      type: "VENDA",
      status: "CANCELADA",
      formaPagamento: "PIX",
    }),
    null,
  );
});
