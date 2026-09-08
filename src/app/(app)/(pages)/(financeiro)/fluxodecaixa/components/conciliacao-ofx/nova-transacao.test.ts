import assert from "node:assert/strict";
import { test } from "node:test";
import { Metodo_pagamento, Tipo_transacao } from "../../types";
import {
  tiposDaConciliacao,
  validarTransacaoOfx,
  type ContextoConciliacaoOfx,
} from "../transactionDialog/conciliacao-ofx";
import { decisaoDeNovaTransacao, transacaoInicialOfx } from "./nova-transacao";
import type { MovimentoAnalisado } from "./types";

const movimento = {
  fingerprint: "extrato-1",
  movimentoId: 9,
  dataPostagem: "2026-08-04",
  valorCentavos: -3157,
  memo: "DEBITO DE IOF",
  nome: null,
  metodoSugerido: "DEBITO AUTOMATICO",
} as MovimentoAnalisado;
const contexto: ContextoConciliacaoOfx = {
  data: "2026-08-04",
  valorCentavos: -3157,
  bancoId: 3,
  onPreparar: () => {},
};

test("o formulário financeiro recebe data, valor, banco e descrição do extrato", () => {
  const inicial = transacaoInicialOfx(movimento, 3);
  assert.equal(inicial.descricao, "DEBITO DE IOF");
  assert.equal(inicial.valor, 31.57);
  assert.equal(inicial.valorLiquido, 31.57);
  assert.equal(inicial.tipo, Tipo_transacao.DESPESA);
  assert.equal(inicial.banco_id, 3);
  assert.equal(inicial.data?.getDate(), 4);
  assert.equal(inicial.data?.getMonth(), 7);
  assert.equal(inicial.pendente, false);
  assert.equal(validarTransacaoOfx(inicial, contexto), null);
});

test("título e classificações editados voltam à decisão e são preservados ao reabrir", () => {
  const editada = {
    ...transacaoInicialOfx(movimento, 3),
    descricao: "IOF do financiamento",
    categoria: "DESPESA FINANCEIRA",
    plano_de_conta_id: 5,
    centro_custo_id: 6,
    fornecedor_id: 7,
    nomepagador: "Banco",
    cpfcnpjpagador: "12345678000199",
    competencia_em: new Date(2026, 6, 1, 12),
    metodopagamento: "PIX" as Metodo_pagamento,
  };
  assert.equal(validarTransacaoOfx(editada, contexto), null);
  const decisao = decisaoDeNovaTransacao(movimento, editada);
  assert.equal(decisao.acao, "CRIAR");
  assert.equal(decisao.movimentoId, 9);
  assert.equal(decisao.nova?.descricao, "IOF do financiamento");
  assert.equal(decisao.nova?.fornecedor_id, 7);
  assert.equal(decisao.nova?.categoria, "DESPESA FINANCEIRA");
  const reaberta = transacaoInicialOfx(movimento, 3, decisao);
  assert.deepEqual(reaberta, editada);
  assert.equal(movimento.memo, "DEBITO DE IOF");
});

test("editar a descrição não permite inverter direção nem alterar dinheiro, conta ou data", () => {
  const inicial = transacaoInicialOfx(movimento, 3);
  for (const alteracao of [
    { tipo: Tipo_transacao.RECEITA },
    { valor: 32 },
    { valorLiquido: 30 },
    { banco_id: 4 },
    { data: new Date(2026, 7, 5) },
    { pendente: true },
    { parcelas: 2 },
    { descricao: " " },
    { metodopagamento: undefined },
  ]) {
    assert.ok(validarTransacaoOfx({ ...inicial, ...alteracao }, contexto));
  }
  assert.deepEqual(tiposDaConciliacao(-100), [
    Tipo_transacao.DESPESA,
    Tipo_transacao.SAQUE,
  ]);
  assert.deepEqual(tiposDaConciliacao(100), [
    Tipo_transacao.RECEITA,
    Tipo_transacao.DEPOSITO,
  ]);
});
