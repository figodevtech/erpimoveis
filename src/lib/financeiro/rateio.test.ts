import assert from "node:assert/strict";
import test from "node:test";

import {
  distribuirPorPesos,
  distribuirValoresIguais,
  paraCentavos,
  paraReais,
  somarCentavos,
  validarRateio,
} from "./rateio";

/** Atalho para montar linhas nos testes de rateio. */
const linha = (id: number, valor: number, valorLiquido = valor) => ({
  id,
  valor,
  valorLiquido,
});

test("converte para centavos sem erro de ponto flutuante", () => {
  assert.equal(paraCentavos(100.01), 10001);
  assert.equal(paraCentavos("100,01"), 10001);
  assert.equal(paraCentavos("100.01"), 10001);
  assert.equal(paraCentavos(null), 0);
  assert.equal(paraCentavos("abc"), 0);
});

test("soma em centavos não acumula resíduo binário", () => {
  // Em ponto flutuante, 0.1 + 0.2 !== 0.3; somando em centavos, fecha.
  assert.equal(somarCentavos([0.1, 0.2]), 30);
  assert.equal(somarCentavos([100.01, 100, 100]), 30001);
  assert.equal(paraReais(somarCentavos([0.1, 0.2])), 0.3);
});

test("distribui valores iguais devolvendo a soma exata", () => {
  // O caso do usuário: 300,01 em 3x não divide redondo.
  const parcelas = distribuirValoresIguais(300.01, 3);
  assert.deepEqual(parcelas, [100.01, 100, 100]);
  assert.equal(somarCentavos(parcelas), paraCentavos(300.01));
});

test("distribui valores iguais quando divide certinho", () => {
  const parcelas = distribuirValoresIguais(300, 3);
  assert.deepEqual(parcelas, [100, 100, 100]);
});

test("distribui valores iguais com centavos sobrando nas primeiras parcelas", () => {
  const parcelas = distribuirValoresIguais(100, 3);
  assert.deepEqual(parcelas, [33.34, 33.33, 33.33]);
  assert.equal(somarCentavos(parcelas), 10000);
});

test("distribuir com quantidade inválida devolve lista vazia", () => {
  assert.deepEqual(distribuirValoresIguais(100, 0), []);
  assert.deepEqual(distribuirValoresIguais(100, -1), []);
});

test("distribui por pesos jogando o resíduo na última posição", () => {
  // Liquidos informados viram pesos para derivar o bruto proporcional.
  const brutos = distribuirPorPesos([9650, 9650, 9651], 30001);
  assert.equal(brutos.reduce((total, valor) => total + valor, 0), 30001);
  assert.equal(brutos.length, 3);
});

test("distribui por pesos protege contra peso total zero", () => {
  assert.deepEqual(distribuirPorPesos([0, 0], 1000), [0, 0]);
});

/* ---------- validarRateio: a regra que destrava o botão ---------- */

test("rateio fecha quando a soma bate com o alvo", () => {
  // O cenário do usuário: digitou 100,01/100/100, a maquineta rateou ao contrário.
  const resultado = validarRateio(
    [linha(1, 100), linha(2, 100), linha(3, 100.01)],
    30001,
  );

  assert.equal(resultado.fecha, true);
  assert.equal(resultado.diferencaEmCentavos, 0);
  assert.deepEqual(resultado.invalidas, []);
  assert.equal(resultado.podeSalvar, true);
});

test("rateio acusa quanto falta e quanto sobra", () => {
  const falta = validarRateio([linha(1, 100), linha(2, 100)], 30001);
  assert.equal(falta.fecha, false);
  assert.equal(falta.diferencaEmCentavos, 10001);
  assert.equal(falta.podeSalvar, false);

  const sobra = validarRateio([linha(1, 200), linha(2, 200)], 30001);
  assert.equal(sobra.diferencaEmCentavos, -9999);
  assert.equal(sobra.podeSalvar, false);
});

test("um centavo de diferença não pode passar", () => {
  // É o motivo de a conta ser feita em centavos: 100.01*3 em float dá 300.03000000000003.
  const resultado = validarRateio(
    [linha(1, 100), linha(2, 100), linha(3, 100.02)],
    30001,
  );
  assert.equal(resultado.fecha, false);
  assert.equal(resultado.diferencaEmCentavos, -1);
});

test("linha zerada é inválida mesmo com a soma fechando", () => {
  // Zerar uma parcela e jogar tudo na outra fecha a soma, mas some com a parcela.
  const resultado = validarRateio([linha(1, 0), linha(2, 300.01)], 30001);

  assert.equal(resultado.fecha, true);
  assert.deepEqual(resultado.invalidas, [1]);
  assert.equal(resultado.podeSalvar, false);
});

test("líquido acima do bruto invalida a linha", () => {
  const resultado = validarRateio(
    [linha(1, 100, 120), linha(2, 100), linha(3, 100.01)],
    30001,
  );

  assert.deepEqual(resultado.invalidas, [1]);
  assert.equal(resultado.podeSalvar, false);
});

test("líquido igual ao bruto é válido", () => {
  const resultado = validarRateio([linha(1, 100, 100)], 10000);
  assert.deepEqual(resultado.invalidas, []);
  assert.equal(resultado.podeSalvar, true);
});

test("líquido zerado invalida a linha", () => {
  const resultado = validarRateio([linha(1, 100, 0)], 10000);
  assert.deepEqual(resultado.invalidas, [1]);
  assert.equal(resultado.podeSalvar, false);
});

test("lista vazia nunca pode salvar", () => {
  const resultado = validarRateio([], 0);
  assert.equal(resultado.fecha, true);
  assert.equal(resultado.podeSalvar, false);
});

test("reporta todas as linhas inválidas, não só a primeira", () => {
  const resultado = validarRateio([linha(1, 0), linha(2, 100, 150), linha(3, 200)], 30000);
  assert.deepEqual(resultado.invalidas, [1, 2]);
});
