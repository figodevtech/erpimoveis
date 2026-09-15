import assert from "node:assert/strict";
import test from "node:test";

import { filtroDeSituacao, totalizarFluxo, valorDaLinha, type LinhaDoFluxo } from "./report-model";

function linha(valores: Partial<LinhaDoFluxo>): LinhaDoFluxo {
  return {
    tipo: "RECEITA",
    pendente: false,
    banco_id: 1,
    valor: 100,
    valorLiquido: null,
    valor_descontos: null,
    valor_baixado: null,
    baixa_de_transacao_id: null,
    adiantamento_id: null,
    ...valores,
  };
}

test("entradas e saídas somam só o que passou por conta, pelo líquido", () => {
  const totais = totalizarFluxo([
    linha({ valor: 100, valorLiquido: 95 }), // cartão: entra o líquido
    linha({ tipo: "DEPOSITO", valor: 40 }),
    linha({ valor: 300, banco_id: null }), // quitado por antecipação
    linha({ tipo: "DESPESA", valor: 80 }),
    linha({ tipo: "SAQUE", valor: 20 }),
    linha({ tipo: "RECEITA", valor: 500, pendente: true }), // título: fica no em aberto
  ]);

  assert.equal(totais.entradas, 135);
  assert.equal(totais.saidas, 100);
  assert.equal(totais.saldo, 35);
});

test("título pago em partes: a baixa entra no realizado e o título só pelo que falta", () => {
  const titulo = linha({ id: 1, valor: 1000, pendente: true, valor_baixado: 400 } as Partial<LinhaDoFluxo>);
  const baixa = linha({ valor: 400, baixa_de_transacao_id: 1 });

  assert.equal(valorDaLinha(titulo), 600);
  const totais = totalizarFluxo([titulo, baixa]);
  assert.equal(totais.entradas, 400);
  assert.equal(totais.aReceber, 600);
});

test("em aberto separa receber de pagar e ignora título antecipado", () => {
  const totais = totalizarFluxo([
    linha({ valor: 200, pendente: true }),
    linha({ valor: 900, pendente: true, adiantamento_id: 7 }),
    linha({ tipo: "DESPESA", valor: 150, pendente: true }),
  ]);

  assert.equal(totais.aReceber, 200);
  assert.equal(totais.aPagar, 150);
  assert.equal(totais.entradas, 0);
  assert.equal(totais.saidas, 0);
});

test("despesa ignora líquido sem desconto lançado, como o dashboard", () => {
  assert.equal(totalizarFluxo([linha({ tipo: "DESPESA", valor: 80, valorLiquido: 1 })]).saidas, 80);
});

test("a situação do diálogo vira o mesmo recorte da lista", () => {
  assert.equal(filtroDeSituacao("false"), "and(pendente.eq.false,banco_id.not.is.null)");
  assert.equal(filtroDeSituacao("true"), "and(pendente.eq.true,baixa_de_transacao_id.is.null)");
  assert.equal(
    filtroDeSituacao(undefined),
    "and(pendente.eq.false,banco_id.not.is.null),and(pendente.eq.true,baixa_de_transacao_id.is.null)",
  );
});
