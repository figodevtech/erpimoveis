import assert from "node:assert/strict";
import test from "node:test";
import { dataDoCalendario } from "./data-calendario";

test("ancora data de calendario ao meio-dia para nao voltar um dia", () => {
  // Sem a ancora, '2026-08-26'::timestamptz na sessao UTC vira 2026-08-26T00:00:00Z,
  // que no fuso do Brasil (UTC-3) e exibido como 25/08.
  assert.equal(dataDoCalendario("2026-08-26"), "2026-08-26T12:00:00");
  assert.equal(dataDoCalendario("2026-01-01"), "2026-01-01T12:00:00");
});

test("preserva timestamps que ja trazem hora", () => {
  assert.equal(dataDoCalendario("2026-08-26T09:30:00"), "2026-08-26T09:30:00");
  assert.equal(dataDoCalendario("2026-08-26T00:00:00.000Z"), "2026-08-26T00:00:00.000Z");
  assert.equal(dataDoCalendario("2026-08-26T00:00:00-03:00"), "2026-08-26T00:00:00-03:00");
});

test("trata ausencia de valor", () => {
  assert.equal(dataDoCalendario(null), null);
  assert.equal(dataDoCalendario(undefined), null);
  assert.equal(dataDoCalendario(""), null);
  assert.equal(dataDoCalendario("   "), null);
});
