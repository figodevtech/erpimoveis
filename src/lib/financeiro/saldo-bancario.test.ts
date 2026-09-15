import assert from "node:assert/strict";
import test from "node:test";
import { saldosAposCadaMovimento, valorAssinadoNoBanco } from "./saldo-bancario";

test("receita e depósito entram na conta, despesa e saque saem", () => {
  assert.equal(valorAssinadoNoBanco("RECEITA", 10), 10);
  assert.equal(valorAssinadoNoBanco("deposito", 10), 10);
  assert.equal(valorAssinadoNoBanco("DESPESA", 10), -10);
  assert.equal(valorAssinadoNoBanco("SAQUE", 10), -10);
  assert.equal(valorAssinadoNoBanco("OUTRO", 10), 0);
});

test("cada movimento carrega o saldo da conta logo depois dele, na ordem recebida", () => {
  // A baixa de um título antigo (id 1) registrada depois de uma receita nova (id 3).
  const saldos = saldosAposCadaMovimento(1000, [
    { id: 3, valorAssinado: 250 },
    { id: 1, valorAssinado: -400 },
    { id: 2, valorAssinado: 50.5 },
  ]);

  assert.deepEqual(
    [...saldos],
    [
      [3, 1250],
      [1, 850],
      [2, 900.5],
    ],
  );
});

test("conta sem movimento não tem saldo por linha", () => {
  assert.equal(saldosAposCadaMovimento(500, []).size, 0);
});

test("o acumulado não arrasta erro de ponto flutuante", () => {
  const movimentos = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, valorAssinado: 0.1 }));
  const saldos = saldosAposCadaMovimento(0.2, movimentos);

  assert.equal(saldos.get(1), 0.3);
  assert.equal(saldos.get(1000), 100.2);
});
