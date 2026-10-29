import assert from "node:assert/strict";
import test from "node:test";
import { competenciaEmMesFechado, mesesDeCompetenciaFechada } from "./competencia";

const agosto = new Date("2026-08-06T12:00:00Z");

test("libera evento sem competencia carimbada", () => {
  // Execucao ainda nao encerrou: o evento nao entrou em periodo nenhum da DRE.
  assert.equal(competenciaEmMesFechado(null, agosto), false);
  assert.equal(competenciaEmMesFechado(undefined, agosto), false);
  assert.equal(competenciaEmMesFechado("", agosto), false);
});

test("libera competencia do mes corrente", () => {
  assert.equal(competenciaEmMesFechado("2026-08-01T12:00:00Z", agosto), false);
  assert.equal(competenciaEmMesFechado("2026-08-31T23:00:00Z", agosto), false);
});

test("bloqueia competencia de mes anterior", () => {
  assert.equal(competenciaEmMesFechado("2026-07-31T12:00:00Z", agosto), true);
  assert.equal(competenciaEmMesFechado("2026-03-20T12:00:00Z", agosto), true);
  assert.equal(competenciaEmMesFechado("2025-12-31T12:00:00Z", agosto), true);
});

test("compara no fuso do Brasil, nao em UTC", () => {
  // 01/08 00:30 UTC ainda e 31/07 21:30 em Sao Paulo: mes fechado.
  assert.equal(competenciaEmMesFechado("2026-08-01T00:30:00Z", agosto), true);
  // 01/09 02:00 UTC e 31/08 23:00 em Sao Paulo: mes corrente, liberado.
  assert.equal(competenciaEmMesFechado("2026-09-01T02:00:00Z", agosto), false);
});

test("lista meses fechados sem repetir e em ordem", () => {
  const meses = mesesDeCompetenciaFechada(
    [
      "2026-07-10T12:00:00Z",
      "2026-03-20T12:00:00Z",
      "2026-07-28T12:00:00Z", // mesmo mes do primeiro
      "2026-08-04T12:00:00Z", // mes corrente, fora
      null,
    ],
    agosto,
  );
  assert.deepEqual(meses, ["03/2026", "07/2026"]);
});

test("lista vazia quando nada esta fechado", () => {
  assert.deepEqual(mesesDeCompetenciaFechada(["2026-08-04T12:00:00Z", null], agosto), []);
});

test("nao bloqueia por data invalida", () => {
  // Preferir liberar a rota a recusar por um dado que nao soubemos interpretar;
  // a trava de status final continua valendo.
  assert.equal(competenciaEmMesFechado("data quebrada", agosto), false);
});
