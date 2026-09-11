import assert from "node:assert/strict";
import test from "node:test";

import {
  MAXIMO_DE_PARCELAS,
  avancarMeses,
  gerarParcelas,
  redistribuirIgualmente,
  redistribuirParaTotal,
  totalDasParcelas,
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
  const parcelas = [
    parcela(1, 100, dia(2026, 9, 12)),
    parcela(2, 100, dia(2026, 10, 12)),
  ];

  const fecha = validarReparcelamento(parcelas, 20000);
  assert.equal(fecha.fecha, true);
  assert.equal(fecha.diferencaEmCentavos, 0);
  assert.equal(fecha.podeSalvar, true);

  const falta = validarReparcelamento(parcelas, 25000);
  assert.equal(falta.diferencaEmCentavos, 5000);
  assert.equal(falta.podeSalvar, false);

  const sobra = validarReparcelamento(parcelas, 15000);
  assert.equal(sobra.diferencaEmCentavos, -5000);
  assert.equal(sobra.podeSalvar, false);
});

test("aponta parcela sem valor mesmo com a soma fechando", () => {
  const resultado = validarReparcelamento(
    [parcela(1, 200, dia(2026, 9, 12)), parcela(2, 0, dia(2026, 10, 12))],
    20000,
  );

  assert.equal(resultado.fecha, true);
  assert.deepEqual(resultado.semValor, [2]);
  assert.equal(resultado.podeSalvar, false);
});

test("vencimento no passado é aceito", () => {
  // Reparcelar é o que se faz com título vencido: exigir data futura impedia
  // até manter a data da parcela que venceu (o IPVA #1330 do Demir).
  const resultado = validarReparcelamento(
    [parcela(1, 100, dia(2019, 3, 4))],
    10000,
  );

  assert.deepEqual(resultado.semVencimento, []);
  assert.equal(resultado.podeSalvar, true);
});

test("parcela sem data escolhida não salva", () => {
  const resultado = validarReparcelamento([parcela(1, 100, undefined)], 10000);

  assert.deepEqual(resultado.semVencimento, [1]);
  assert.equal(resultado.podeSalvar, false);
});

test("recusa mais parcelas do que o teto de sanidade", () => {
  const parcelas = gerarParcelas(6100, 61, dia(2026, 9, 12));

  const resultado = validarReparcelamento(parcelas, 6100);

  assert.equal(resultado.fecha, true);
  assert.equal(resultado.podeSalvar, false);
});

test("total livre: o modo avulso não exige que a soma feche", () => {
  const parcelas = [
    { id: 1, valor: 100, vencimento: new Date(2026, 0, 10) },
    { id: 2, valor: 100, vencimento: new Date(2026, 1, 10) },
  ];

  // Alvo de 300,00 e soma de 200,00: com trava não salva, sem trava salva.
  assert.equal(validarReparcelamento(parcelas, 30000).podeSalvar, false);
  assert.equal(
    validarReparcelamento(parcelas, 30000, { totalTravado: false }).podeSalvar,
    true,
  );
});

test("total livre não afrouxa as regras de linha", () => {
  const semValor = [
    { id: 1, valor: 0, vencimento: new Date(2026, 0, 10) },
    { id: 2, valor: 100, vencimento: new Date(2026, 1, 10) },
  ];
  assert.equal(
    validarReparcelamento(semValor, 10000, { totalTravado: false }).podeSalvar,
    false,
  );

  const semData = [{ id: 1, valor: 100 }];
  assert.equal(
    validarReparcelamento(semData, 10000, { totalTravado: false }).podeSalvar,
    false,
  );

  const demais = Array.from({ length: MAXIMO_DE_PARCELAS + 1 }, (_, indice) => ({
    id: indice + 1,
    valor: 10,
    vencimento: new Date(2026, 0, 10),
  }));
  assert.equal(
    validarReparcelamento(demais, 100, { totalTravado: false }).podeSalvar,
    false,
  );
});

test("totalDasParcelas soma em centavos", () => {
  assert.equal(
    totalDasParcelas([
      { id: 1, valor: 0.1, vencimento: new Date(2026, 0, 10) },
      { id: 2, valor: 0.2, vencimento: new Date(2026, 1, 10) },
    ]),
    30,
  );
  assert.equal(totalDasParcelas([]), 0);
});

test("redistribuirParaTotal preserva a proporção montada", () => {
  const parcelas = [
    { id: 1, valor: 300, vencimento: new Date(2026, 0, 10) },
    { id: 2, valor: 100, vencimento: new Date(2026, 1, 10) },
  ];

  const novas = redistribuirParaTotal(parcelas, 100000);

  assert.deepEqual(
    novas.map((parcela) => parcela.valor),
    [750, 250],
  );
  // As datas escolhidas continuam onde estavam.
  assert.deepEqual(
    novas.map((parcela) => parcela.vencimento),
    parcelas.map((parcela) => parcela.vencimento),
  );
});

test("redistribuirParaTotal fecha exatamente em total indivisível", () => {
  const parcelas = [
    { id: 1, valor: 100, vencimento: new Date(2026, 0, 10) },
    { id: 2, valor: 100, vencimento: new Date(2026, 1, 10) },
    { id: 3, valor: 100, vencimento: new Date(2026, 2, 10) },
  ];

  const novas = redistribuirParaTotal(parcelas, 10000);

  assert.equal(totalDasParcelas(novas), 10000);
  // O resíduo de `distribuirPorPesos` cai na última — ao contrário do rateio
  // igual, que joga nas primeiras.
  assert.deepEqual(
    novas.map((parcela) => parcela.valor),
    [33.33, 33.33, 33.34],
  );
});

test("redistribuirParaTotal sem proporção cai no rateio igual", () => {
  const parcelas = [
    { id: 1, valor: 0, vencimento: new Date(2026, 0, 10) },
    { id: 2, valor: 0, vencimento: new Date(2026, 1, 10) },
  ];

  const novas = redistribuirParaTotal(parcelas, 10001);

  assert.equal(totalDasParcelas(novas), 10001);
  // Rateio igual: o centavo que sobra vai para a primeira.
  assert.deepEqual(
    novas.map((parcela) => parcela.valor),
    [50.01, 50],
  );
});
