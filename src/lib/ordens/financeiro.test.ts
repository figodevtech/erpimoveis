import assert from "node:assert/strict";
import test from "node:test";

import {
  calcularResumoFinanceiroOs,
  podeRegistrarPagamentoOs,
  statusAposEncerrarExecucao,
} from "./financeiro";

test("permite lançamento somente depois da aprovação e antes da conclusão", () => {
  assert.equal(podeRegistrarPagamentoOs("ORCAMENTO_APROVADO"), true);
  assert.equal(podeRegistrarPagamentoOs("EM_ANDAMENTO"), true);
  assert.equal(podeRegistrarPagamentoOs("PAGAMENTO"), true);
  assert.equal(podeRegistrarPagamentoOs("ORCAMENTO"), false);
  assert.equal(podeRegistrarPagamentoOs("CONCLUIDO"), false);
});

test("separa o recebido do pendente e usa ambos para a quitação", () => {
  const resumo = calcularResumoFinanceiroOs({
    totalComercial: 1_000,
    transacoes: [
      { tipo: "RECEITA", valor: 250, pendente: false },
      { tipo: "RECEITA", valor: 300, pendente: true },
      { tipo: "DESPESA", valor: 900, pendente: false },
      { tipo: "RECEITA", valor: 100, pendente: false, evento_financeiro_id: 9 },
    ],
  });

  assert.deepEqual(resumo, {
    totalDevido: 1_000,
    valorRecebido: 250,
    valorPendente: 300,
    valorComprometido: 550,
    saldoAReceber: 750,
    saldoDisponivelParaLancamento: 450,
    quantidadeTransacoes: 2,
    quitada: false,
  });
});

test("títulos pendentes quitam a OS quando cobrem todo o valor", () => {
  const resumo = calcularResumoFinanceiroOs({
    totalComercial: 1_000,
    transacoes: [
      { tipo: "RECEITA", valor: 400, pendente: false },
      { tipo: "RECEITA", valor: 300, pendente: true },
      { tipo: "RECEITA", valor: 300, pendente: true },
    ],
  });

  assert.equal(resumo.valorRecebido, 400);
  assert.equal(resumo.valorPendente, 600);
  assert.equal(resumo.valorComprometido, 1_000);
  assert.equal(resumo.saldoAReceber, 600);
  assert.equal(resumo.saldoDisponivelParaLancamento, 0);
  assert.equal(resumo.quitada, true);
});

test("usa valor de face e inclui o acréscimo financeiro da OS", () => {
  const resumo = calcularResumoFinanceiroOs({
    totalComercial: 1_000,
    acrescimoFinanceiroTipo: "FIXO",
    acrescimoFinanceiroValor: 100,
    transacoes: [
      { tipo: "RECEITA", valor: 1_130, valor_acrescimos: 30, pendente: false },
    ],
  });

  assert.equal(resumo.totalDevido, 1_100);
  assert.equal(resumo.valorRecebido, 1_100);
  assert.equal(resumo.quitada, true);
  assert.equal(resumo.saldoAReceber, 0);
});

test("fim da execução depende da quitação", () => {
  assert.equal(statusAposEncerrarExecucao(false), "PAGAMENTO");
  assert.equal(statusAposEncerrarExecucao(true), "CONCLUIDO");
});
