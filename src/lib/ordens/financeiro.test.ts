import assert from "node:assert/strict";
import test from "node:test";

import {
  calcularResumoFinanceiroOs,
  podeRegistrarPagamentoOs,
  statusAposEncerrarExecucao,
} from "./financeiro";

test("faturamento opcional troca a fila de registros e preserva adiantamentos", () => {
  for (const ativo of [false, true]) {
    assert.equal(podeRegistrarPagamentoOs("ORCAMENTO_APROVADO", ativo), true);
    assert.equal(podeRegistrarPagamentoOs("EM_ANDAMENTO", ativo), true);
    assert.equal(podeRegistrarPagamentoOs("PAGAMENTO", ativo), !ativo);
    assert.equal(podeRegistrarPagamentoOs("FATURAMENTO", ativo), ativo);
    for (const status of ["ORCAMENTO", "CONCLUIDO", "SEM_COBRANCA", "CANCELADO"]) {
      assert.equal(podeRegistrarPagamentoOs(status, ativo), false);
    }
  }
  assert.equal(podeRegistrarPagamentoOs("FATURAMENTO"), false);
});

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

test("título pago pela metade conta nos dois lados do resumo", () => {
  // Um título de R$ 1.000 com R$ 400 já pagos é recebimento e pendência ao mesmo
  // tempo. Tratá-lo como uma coisa só falsearia os dois lados.
  const resumo = calcularResumoFinanceiroOs({
    totalComercial: 1_000,
    transacoes: [
      { tipo: "RECEITA", valor: 1_000, pendente: true, valor_baixado: 400 },
    ],
  });

  assert.equal(resumo.valorRecebido, 400);
  assert.equal(resumo.valorPendente, 600);
  // O compromisso não mudou por causa da forma de pagar.
  assert.equal(resumo.valorComprometido, 1_000);
  assert.equal(resumo.saldoAReceber, 600);
  assert.equal(resumo.quitada, true);
});

test("baixa parcial não altera o resumo de quem não tem nenhuma", () => {
  const semParcial = calcularResumoFinanceiroOs({
    totalComercial: 1_000,
    transacoes: [{ tipo: "RECEITA", valor: 1_000, pendente: true }],
  });
  const comZero = calcularResumoFinanceiroOs({
    totalComercial: 1_000,
    transacoes: [{ tipo: "RECEITA", valor: 1_000, pendente: true, valor_baixado: 0 }],
  });

  assert.deepEqual(comZero, semParcial);
  assert.equal(semParcial.valorRecebido, 0);
  assert.equal(semParcial.valorPendente, 1_000);
});

test("o acréscimo fica fora da parte paga, como no valor de face", () => {
  const resumo = calcularResumoFinanceiroOs({
    totalComercial: 1_000,
    transacoes: [
      {
        tipo: "RECEITA",
        valor: 1_050,
        valor_acrescimos: 50,
        pendente: true,
        valor_baixado: 400,
      },
    ],
  });

  // Face é 1.000; pagos 400; falta 600. O juros não infla o que a OS deve.
  assert.equal(resumo.valorRecebido, 400);
  assert.equal(resumo.valorPendente, 600);
});
