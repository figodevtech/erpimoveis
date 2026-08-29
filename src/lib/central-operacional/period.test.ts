import assert from "node:assert/strict";
import test from "node:test";

import { nextOperationalPeriod, operationalPeriodWindow } from "./period";

const NOW = new Date("2026-08-27T15:00:00.000Z");

test("período diário respeita o dia da oficina em UTC-3", () => {
  assert.deepEqual(operationalPeriodWindow("DIARIO", NOW), {
    start: "2026-08-27T03:00:00.000Z",
    end: "2026-08-28T03:00:00.000Z",
    detailLabel: "hoje",
    counterLabel: "HOJE",
  });
});

test("semana começa na segunda-feira e mês usa limites semiabertos", () => {
  assert.deepEqual(operationalPeriodWindow("SEMANAL", NOW), {
    start: "2026-08-24T03:00:00.000Z",
    end: "2026-08-31T03:00:00.000Z",
    detailLabel: "nesta semana",
    counterLabel: "SEMANA",
  });
  assert.deepEqual(operationalPeriodWindow("MENSAL", NOW), {
    start: "2026-08-01T03:00:00.000Z",
    end: "2026-09-01T03:00:00.000Z",
    detailLabel: "neste mês",
    counterLabel: "MÊS",
  });
});

test("botão geral percorre diário, semanal e mensal", () => {
  assert.equal(nextOperationalPeriod("DIARIO"), "SEMANAL");
  assert.equal(nextOperationalPeriod("SEMANAL"), "MENSAL");
  assert.equal(nextOperationalPeriod("MENSAL"), "DIARIO");
});
