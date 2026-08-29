import assert from "node:assert/strict";
import test from "node:test";

import {
  formatOperationalEventValue,
  formatOperationalIndicator,
  relativeOperationalTime,
} from "./formatters";

test("privacidade mascara dinheiro sem ocultar contagens", () => {
  assert.equal(formatOperationalEventValue(125.5, null, true), "R$ ••••••");
  assert.equal(formatOperationalIndicator({ tipo: "MOEDA", valor: 125.5, sufixo: null }, true), "R$ ••••••");
  assert.equal(formatOperationalIndicator({ tipo: "CONTAGEM", valor: 3, sufixo: "OS" }, true), "3 OS");
});

test("tempo relativo usa um instante compartilhado", () => {
  const now = new Date("2026-08-27T12:00:30.000Z").getTime();
  assert.equal(relativeOperationalTime("2026-08-27T12:00:00.000Z", now), "há 30s");
});
