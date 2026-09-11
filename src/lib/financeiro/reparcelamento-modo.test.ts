import test from "node:test";
import assert from "node:assert/strict";

import { modoDeReparcelamento } from "./reparcelamento-modo";

test("modo de reparcelamento", async (t) => {
  await t.test("avulso com grupo formal libera o total", () => {
    const classificacao = modoDeReparcelamento({ parcelamento_id: 7 });
    assert.equal(classificacao.modo, "AVULSO");
    assert.deepEqual(classificacao.grupo, { tipo: "PARCELAMENTO", id: 7 });
    assert.equal(classificacao.motivo, null);
  });

  await t.test("OS trava o total e o grupo é o documento", () => {
    const classificacao = modoDeReparcelamento({ ordemservicoid: 164 });
    assert.equal(classificacao.modo, "VINCULADO");
    assert.deepEqual(classificacao.grupo, { tipo: "OS", id: 164 });
  });

  await t.test("venda trava o total e o grupo é o documento", () => {
    const classificacao = modoDeReparcelamento({ vendaid: 42 });
    assert.equal(classificacao.modo, "VINCULADO");
    assert.deepEqual(classificacao.grupo, { tipo: "VENDA", id: 42 });
  });

  await t.test("OS sem grupo formal continua reparcelável", () => {
    // O cadastro nunca criou `transacao_parcelamento` para documento: se o grupo
    // dependesse dele, todo parcelamento de OS já existente ficaria de fora.
    const classificacao = modoDeReparcelamento({
      ordemservicoid: 164,
      parcelamento_id: null,
    });
    assert.equal(classificacao.modo, "VINCULADO");
  });

  await t.test("nota de compra: grupo formal, total travado", () => {
    const classificacao = modoDeReparcelamento({
      entrada_id: 9,
      parcelamento_id: 12,
    });
    assert.equal(classificacao.modo, "VINCULADO");
    assert.deepEqual(classificacao.grupo, { tipo: "PARCELAMENTO", id: 12 });
  });

  await t.test("uso e consumo se comporta como nota de compra", () => {
    const classificacao = modoDeReparcelamento({
      usoconsumo_entrada_id: 3,
      parcelamento_id: 12,
    });
    assert.equal(classificacao.modo, "VINCULADO");
  });

  await t.test("entrada sem grupo formal não tem onde escrever", () => {
    assert.equal(modoDeReparcelamento({ entrada_id: 9 }).modo, "BLOQUEADO");
  });

  await t.test("bloqueia transferência", () => {
    const classificacao = modoDeReparcelamento({ transferencia_id: 1 });
    assert.equal(classificacao.modo, "BLOQUEADO");
    assert.match(classificacao.motivo ?? "", /Transferência entre contas/);
    assert.equal(classificacao.grupo, null);
  });

  await t.test("bloqueia pagamento múltiplo", () => {
    const classificacao = modoDeReparcelamento({ pagamento_multiplo_id: 5 });
    assert.equal(classificacao.modo, "BLOQUEADO");
    assert.match(classificacao.motivo ?? "", /rateio do pagamento múltiplo/);
  });

  await t.test("bloqueia evento financeiro", () => {
    const classificacao = modoDeReparcelamento({ evento_financeiro_id: 8 });
    assert.equal(classificacao.modo, "BLOQUEADO");
    assert.match(classificacao.motivo ?? "", /um por evento/);
  });

  await t.test("bloqueia título antecipado, pelos dois lados da antecipação", () => {
    assert.equal(modoDeReparcelamento({ adiantamento_id: 2 }).modo, "BLOQUEADO");
    assert.equal(modoDeReparcelamento({ eh_adiantamento: true }).modo, "BLOQUEADO");
    // `false` é o valor de toda transação comum: não pode bloquear nada.
    assert.equal(
      modoDeReparcelamento({ eh_adiantamento: false, parcelamento_id: 7 }).modo,
      "AVULSO",
    );
  });

  await t.test("o bloqueio tem precedência sobre o documento", () => {
    // Pagamento múltiplo aponta para a OS e para o rateio ao mesmo tempo.
    // Perguntar primeiro pela OS o classificaria como reparcelável.
    const classificacao = modoDeReparcelamento({
      ordemservicoid: 164,
      pagamento_multiplo_id: 5,
    });
    assert.equal(classificacao.modo, "BLOQUEADO");
    assert.match(classificacao.motivo ?? "", /vários documentos/);
  });

  await t.test("sem vínculo nenhum não há grupo", () => {
    const classificacao = modoDeReparcelamento({});
    assert.equal(classificacao.modo, "BLOQUEADO");
    assert.match(classificacao.motivo ?? "", /não faz parte de um parcelamento/);
  });

  await t.test("transação ausente não quebra", () => {
    assert.equal(modoDeReparcelamento(null).modo, "BLOQUEADO");
    assert.equal(modoDeReparcelamento(undefined).modo, "BLOQUEADO");
  });

  await t.test("id em texto, como vem do PostgREST", () => {
    assert.deepEqual(modoDeReparcelamento({ ordemservicoid: "164" }).grupo, {
      tipo: "OS",
      id: 164,
    });
  });
});
