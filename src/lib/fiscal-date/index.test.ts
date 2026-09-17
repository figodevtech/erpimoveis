import assert from "node:assert/strict";
import test from "node:test";

import {
  competenceFromCivilDate,
  endOfCompetence,
  formatEfdDate,
  parseCompetence,
  parseFiscalDate,
} from "./index";

test("preserva data civil e offset do XML próximo à meia-noite", () => {
  const parsed = parseFiscalDate("2026-08-31T23:59:59-03:00");
  assert.deepEqual(parsed, {
    civilDate: "2026-08-31",
    originalText: "2026-08-31T23:59:59-03:00",
    originalOffset: "-03:00",
    instantUtc: "2026-09-01T02:59:59.000Z",
  });
  assert.equal(competenceFromCivilDate(parsed!.civilDate), "2026-08");
  assert.equal(formatEfdDate(parsed!), "31082026");
});

test("timestamp com outro offset não muda a competência civil", () => {
  const parsed = parseFiscalDate("2026-08-01T00:05:00+05:30", {
    timezoneIana: "America/Fortaleza",
  });
  assert.equal(parsed?.civilDate, "2026-08-01");
  assert.equal(parsed?.originalOffset, "+05:30");
  assert.equal(parsed?.instantUtc, "2026-07-31T18:35:00.000Z");
  assert.equal(parsed?.timezoneIana, "America/Fortaleza");
});

test("fonte sem offset preserva data e não inventa instante UTC", () => {
  const parsed = parseFiscalDate("2026-08-01T00:05:00", {
    timezoneIana: "America/Fortaleza",
  });
  assert.equal(parsed?.civilDate, "2026-08-01");
  assert.equal(parsed?.instantUtc, undefined);
  assert.equal(parsed?.originalOffset, undefined);
});

test("recusa datas, timezone e competências inválidas", () => {
  assert.equal(parseFiscalDate("2026-02-30"), null);
  assert.equal(parseFiscalDate("2026-08-01", { timezoneIana: "Fuso/Inexistente" }), null);
  assert.throws(() => parseCompetence("2026-13"));
  assert.deepEqual(parseCompetence("2026-08"), { start: "2026-08-01", year: 2026, month: 8 });
  assert.equal(endOfCompetence("2026-02"), "2026-02-28");
});
