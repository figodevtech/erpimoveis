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

test("pagamento a vista pontua 100", () => {
  const resumo = calcularScoreCliente([titulo()], hoje);

  assert.equal(resumo.score, 100);
  assert.equal(resumo.classificacao, "EXCELENTE");
  assert.equal(resumo.totalRecebido, 100);
  assert.equal(resumo.quantidadeAvaliada, 1);
  assert.equal(resumo.titulos[0].situacao, "PAGO_A_VISTA");
  assert.equal(resumo.titulos[0].diasAtraso, 0);
});

test("titulo pago antes do vencimento pontua 100", () => {
  const resumo = calcularScoreCliente([
    titulo({
      vencimentoEm: "2026-09-01T00:00:00-03:00",
      pagoEm: "2026-08-05T12:00:00-03:00",
    }),
  ], hoje);

  assert.equal(resumo.score, 100);
  assert.equal(resumo.titulos[0].situacao, "PAGO_EM_DIA");
});

test("a vista nao apaga o atraso de um titulo a prazo", () => {
  const resumo = calcularScoreCliente([
    titulo({ id: 1, valor: 100 }),
    titulo({ id: 2, valor: 100, vencimentoEm: "2026-07-20", pagoEm: "2026-07-30" }),
  ], hoje);

  // (100 * 100 + 80 * 100) / 200
  assert.equal(resumo.score, 90);
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

  // 5 dias de atraso valem nota 90, mas título vencido em aberto trava em 59.
  assert.equal(resumo.scoreBase, 90);
  assert.equal(resumo.score, 59);
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

test("titulo vencido em aberto limita o Score a 59", () => {
  const resumo = calcularScoreCliente([
    titulo({ id: 1, valor: 10_000 }),
    titulo({ id: 2, valor: 100, pendente: true, data: "2026-08-05T00:00:00-03:00" }),
  ], hoje);

  // (100 × 10.000 + 90 × 100) / 10.100 ≈ 100: o vencido some na média ponderada.
  assert.equal(resumo.scoreBase, 100);
  assert.equal(resumo.score, 59);
  assert.equal(resumo.tetoAplicado, 59);
  assert.equal(resumo.classificacao, "ATENCAO");
  assert.equal(resumo.maiorAtrasoEmAberto, 5);
});

test("atraso acima de 30 dias derruba o teto para 39", () => {
  const resumo = calcularScoreCliente([
    titulo({ id: 1, valor: 10_000 }),
    titulo({ id: 2, valor: 100, pendente: true, data: "2026-06-10T00:00:00-03:00" }),
  ], hoje);

  assert.equal(resumo.score, 39);
  assert.equal(resumo.tetoAplicado, 39);
  assert.equal(resumo.classificacao, "CRITICO");
});

test("teto limita, mas nunca promove um historico ruim", () => {
  const resumo = calcularScoreCliente([
    titulo({ id: 1, valor: 100, pendente: true, data: "2026-05-01T00:00:00-03:00" }),
  ], hoje);

  assert.equal(resumo.scoreBase, 0);
  assert.equal(resumo.score, 0);
  assert.equal(resumo.tetoAplicado, null);
});

test("titulo que vence hoje nao aciona o teto", () => {
  const resumo = calcularScoreCliente([
    titulo({ id: 1, valor: 10_000 }),
    titulo({ id: 2, valor: 100, pendente: true, data: "2026-08-10T00:00:00-03:00" }),
  ], hoje);

  assert.equal(resumo.titulos.some((t) => t.situacao === "VENCE_HOJE"), true);
  assert.equal(resumo.score, 100);
  assert.equal(resumo.tetoAplicado, null);
  assert.equal(resumo.maiorAtrasoEmAberto, null);
});

test("pontualidade ignora os pagamentos a vista", () => {
  const resumo = calcularScoreCliente([
    titulo({ id: 1 }),
    titulo({ id: 2 }),
    titulo({ id: 3, vencimentoEm: "2026-07-20", pagoEm: "2026-07-30" }),
  ], hoje);

  // 1 de 1 título a prazo, pago com 10 dias de atraso — os dois à vista ficam fora.
  assert.equal(resumo.percentualPagoEmDia, 0);
  assert.equal(resumo.mediaDiasAtraso, 10);
});

test("cliente so de a vista nao tem indicador de pontualidade", () => {
  const resumo = calcularScoreCliente([titulo()], hoje);

  assert.equal(resumo.percentualPagoEmDia, null);
  assert.equal(resumo.mediaDiasAtraso, null);
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

test("baixa parcial reduz o que o cliente ainda deve", () => {
  // Cobrar o valor cheio puniria por uma dívida que ele já reduziu — e é o
  // pagamento parcial que mostra que ele está tentando pagar.
  const resumo = calcularScoreCliente(
    [
      titulo({
        valor: 1_000,
        valorBaixado: 400,
        pendente: true,
        vencimentoEm: "2026-09-10T12:00:00-03:00",
      }),
    ],
    hoje,
  );

  assert.equal(resumo.totalEmAberto, 600);
});

test("título vencido pesa pelo saldo, não pelo valor de face", () => {
  const resumo = calcularScoreCliente(
    [
      titulo({
        valor: 1_000,
        valorBaixado: 400,
        pendente: true,
        vencimentoEm: "2026-08-01T12:00:00-03:00",
      }),
    ],
    hoje,
  );

  assert.equal(resumo.totalVencido, 600);
  assert.equal(resumo.totalEmAberto, 600);
});
