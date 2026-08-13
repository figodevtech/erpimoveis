import assert from "node:assert/strict";
import test from "node:test";

import {
  avancarMeses,
  gerarParcelas,
  redistribuirIgualmente,
  validarReparcelamento,
} from "./reparcelamento";

const dia = (ano: number, mes: number, data: number) => new Date(ano, mes - 1, data);

/** Atalho para montar parcelas nos testes. */
const parcela = (id: number, valor: number, vencimento?: Date) => ({
  id,
  valor,
  vencimento,
});

test("avança meses sem transbordar para o mês seguinte", () => {
  // 31/01 + 1 mês com setMonth puro cai em 03/03: duas parcelas em março e
  // nenhuma em fevereiro.
  assert.deepEqual(avancarMeses(dia(2026, 1, 31), 1), dia(2026, 2, 28));
  assert.deepEqual(avancarMeses(dia(2024, 1, 31), 1), dia(2024, 2, 29));
  assert.deepEqual(avancarMeses(dia(2026, 1, 31), 3), dia(2026, 4, 30));
  assert.deepEqual(avancarMeses(dia(2026, 12, 15), 1), dia(2027, 1, 15));
});

test("gera parcelas mensais que somam exatamente o total", () => {
  const parcelas = gerarParcelas(31005, 3, dia(2026, 8, 15));

  assert.deepEqual(
    parcelas.map((item) => item.valor),
    [103.35, 103.35, 103.35],
  );
  assert.deepEqual(
    parcelas.map((item) => item.vencimento),
    [dia(2026, 8, 15), dia(2026, 9, 15), dia(2026, 10, 15)],
  );
});

test("o centavo que sobra vai para as primeiras parcelas", () => {
  const parcelas = gerarParcelas(10000, 3, dia(2026, 8, 15));

  assert.deepEqual(
    parcelas.map((item) => item.valor),
    [33.34, 33.33, 33.33],
  );
  assert.equal(
    parcelas.reduce((total, item) => total + Math.round(item.valor * 100), 0),
    10000,
  );
});

test("redistribuir igualmente mantém as datas escolhidas", () => {
  const original = [
    parcela(1, 50, dia(2026, 9, 5)),
    parcela(2, 150, dia(2026, 10, 20)),
  ];

  const resultado = redistribuirIgualmente(original, 20000);

  assert.deepEqual(
    resultado.map((item) => item.valor),
    [100, 100],
  );
  assert.deepEqual(
    resultado.map((item) => item.vencimento),
    [dia(2026, 9, 5), dia(2026, 10, 20)],
  );
});

test("só destrava quando a soma bate com o que está pendente", () => {
  const hoje = dia(2026, 8, 12);
  const parcelas = [
    parcela(1, 100, dia(2026, 9, 12)),
    parcela(2, 100, dia(2026, 10, 12)),
  ];

  const fecha = validarReparcelamento(parcelas, 20000, hoje);
  assert.equal(fecha.fecha, true);
  assert.equal(fecha.diferencaEmCentavos, 0);
  assert.equal(fecha.podeSalvar, true);

  const falta = validarReparcelamento(parcelas, 25000, hoje);
  assert.equal(falta.diferencaEmCentavos, 5000);
  assert.equal(falta.podeSalvar, false);

  const sobra = validarReparcelamento(parcelas, 15000, hoje);
  assert.equal(sobra.diferencaEmCentavos, -5000);
  assert.equal(sobra.podeSalvar, false);
});

test("aponta parcela sem valor mesmo com a soma fechando", () => {
  const hoje = dia(2026, 8, 12);
  const resultado = validarReparcelamento(
    [
      parcela(1, 200, dia(2026, 9, 12)),
      parcela(2, 0, dia(2026, 10, 12)),
    ],
    20000,
    hoje,
  );

  assert.equal(resultado.fecha, true);
  assert.deepEqual(resultado.semValor, [2]);
  assert.equal(resultado.podeSalvar, false);
});

test("recusa vencimento no passado e aceita o dia de hoje", () => {
  const hoje = new Date(2026, 7, 12, 15, 30);

  const ontem = validarReparcelamento(
    [parcela(1, 100, dia(2026, 8, 11))],
    10000,
    hoje,
  );
  assert.deepEqual(ontem.vencimentoInvalido, [1]);
  assert.equal(ontem.podeSalvar, false);

  // Vencer hoje é legítimo: o título está em aberto até o fim do dia.
  const agora = validarReparcelamento(
    [parcela(1, 100, dia(2026, 8, 12))],
    10000,
    hoje,
  );
  assert.deepEqual(agora.vencimentoInvalido, []);
  assert.equal(agora.podeSalvar, true);
});

test("parcela sem data escolhida não salva", () => {
  const resultado = validarReparcelamento(
    [parcela(1, 100, undefined)],
    10000,
    dia(2026, 8, 12),
  );

  assert.deepEqual(resultado.vencimentoInvalido, [1]);
  assert.equal(resultado.podeSalvar, false);
});

test("recusa mais parcelas do que o teto de sanidade", () => {
  const hoje = dia(2026, 8, 12);
  const parcelas = gerarParcelas(6100, 61, dia(2026, 9, 12));

  const resultado = validarReparcelamento(parcelas, 6100, hoje);

  assert.equal(resultado.fecha, true);
  assert.equal(resultado.podeSalvar, false);
});
