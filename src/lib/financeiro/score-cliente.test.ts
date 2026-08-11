import assert from "node:assert/strict";
import test from "node:test";

import { calcularScoreCliente, type TituloClienteInput } from "./score-cliente";

const hoje = new Date("2026-08-10T12:00:00-03:00");

function titulo(overrides: Partial<TituloClienteInput> = {}): TituloClienteInput {
  return {
    id: 1,
    valor: 100,
    pendente: false,
    data: "2026-08-10T12:00:00-03:00",
    ordemServicoId: 10,
    ...overrides,
  };
}

test("nao cria Score com pagamento a vista", () => {
  const resumo = calcularScoreCliente([titulo()], hoje);

  assert.equal(resumo.score, null);
  assert.equal(resumo.classificacao, "SEM_HISTORICO");
  assert.equal(resumo.totalRecebido, 100);
});

test("titulo futuro pago no vencimento recebe nota 100", () => {
  const resumo = calcularScoreCliente([
    titulo({
      vencimentoEm: "2026-08-01T00:00:00-03:00",
      pagoEm: "2026-08-01T18:00:00-03:00",
    }),
  ], hoje);

  assert.equal(resumo.score, 100);
  assert.equal(resumo.percentualPagoEmDia, 100);
  assert.equal(resumo.titulos[0].situacao, "PAGO_EM_DIA");
});

test("perde dois pontos por dia de atraso", () => {
  const resumo = calcularScoreCliente([
    titulo({
      vencimentoEm: "2026-07-20T00:00:00-03:00",
      pagoEm: "2026-07-30T12:00:00-03:00",
    }),
  ], hoje);

  assert.equal(resumo.score, 80);
  assert.equal(resumo.mediaDiasAtraso, 10);
  assert.equal(resumo.titulos[0].situacao, "PAGO_EM_ATRASO");
});

test("pondera o Score pelo valor de cada titulo", () => {
  const resumo = calcularScoreCliente([
    titulo({ id: 1, valor: 100, vencimentoEm: "2026-08-01", pagoEm: "2026-08-01" }),
    titulo({ id: 2, valor: 300, vencimentoEm: "2026-07-20", pagoEm: "2026-07-30" }),
  ], hoje);

  assert.equal(resumo.score, 85);
});

test("titulo vencido em aberto reduz o Score enquanto o atraso aumenta", () => {
  const resumo = calcularScoreCliente([
    titulo({
      pendente: true,
      data: "2026-08-05T00:00:00-03:00",
      vencimentoEm: null,
      pagoEm: null,
    }),
  ], hoje);

  assert.equal(resumo.score, 90);
  assert.equal(resumo.totalEmAberto, 100);
  assert.equal(resumo.totalVencido, 100);
  assert.equal(resumo.quantidadeVencida, 1);
  assert.equal(resumo.titulos[0].situacao, "VENCIDO");
});

test("titulo que ainda nao venceu entra nos KPIs, mas nao no Score", () => {
  const resumo = calcularScoreCliente([
    titulo({
      pendente: true,
      data: "2026-08-20T00:00:00-03:00",
      vencimentoEm: null,
    }),
  ], hoje);

  assert.equal(resumo.score, null);
  assert.equal(resumo.totalAVencer, 100);
  assert.equal(resumo.quantidadeAvaliada, 0);
  assert.equal(resumo.titulos[0].situacao, "A_VENCER");
});

test("desconsidera acrescimos financeiros no valor de face", () => {
  const resumo = calcularScoreCliente([
    titulo({
      valor: 110,
      valorAcrescimos: 10,
      pendente: true,
      data: "2026-08-05T00:00:00-03:00",
    }),
  ], hoje);

  assert.equal(resumo.totalEmAberto, 100);
  assert.equal(resumo.totalVencido, 100);
});
