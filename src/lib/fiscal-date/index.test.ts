import assert from "node:assert/strict";
import test from "node:test";

import {
  competenceFromCivilDate,
  dataCivilDeHoje,
  dataCivilDoInstante,
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

test("data civil usa o fuso do emitente, não o UTC", () => {
  // 22:30 de 22/09 em João Pessoa (UTC-3) já é 01:30 de 23/09 em UTC.
  const noiteDePB = new Date("2026-09-23T01:30:00Z");
  assert.equal(dataCivilDoInstante(noiteDePB), "2026-09-22");
  assert.equal(noiteDePB.toISOString().slice(0, 10), "2026-09-23");
});

test("na virada de vigência, a data do emitente é a que vale", () => {
  // 31/03/2025 23:00 em João Pessoa: a alíquota do PI ainda é a de 21%.
  // Em UTC já seria 01/04, quando passa a valer 22,5%.
  const vesperaDaMudanca = new Date("2025-04-01T02:00:00Z");
  assert.equal(dataCivilDoInstante(vesperaDaMudanca), "2025-03-31");
});

test("fuso inválido cai no padrão em vez de quebrar a emissão", () => {
  const instante = new Date("2026-09-23T01:30:00Z");
  assert.equal(dataCivilDeHoje("Fuso/Inexistente", instante), "2026-09-22");
});

test("data civil de hoje tem o formato AAAA-MM-DD", () => {
  assert.match(dataCivilDeHoje(), /^\d{4}-\d{2}-\d{2}$/);
});
