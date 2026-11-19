import assert from "node:assert/strict";
import { test } from "node:test";
import { occupancyCalendar } from "./ical";

test("exporta noites com saída exclusiva e identificador estável", () => {
  const rows = [{ id: 4, inicio: "2026-12-24", fim: "2026-12-26" }];
  const first = occupancyCalendar(2, rows, "2028-11-19", new Date("2026-11-19T12:00:00Z"));
  assert.ok(first.includes("DTSTART;VALUE=DATE:20261224\r\nDTEND;VALUE=DATE:20261226"));
  assert.ok(first.includes("DTSTAMP:20261119T120000Z"));
  assert.ok(first.includes("UID:imovel-2-ocupacao-4@erpimoveis"));
  assert.ok(first.endsWith("END:VCALENDAR\r\n"));
  assert.equal(first.split("BEGIN:VEVENT").length - 1, 1);
});

test("locação sem fim bloqueia até o horizonte e cancelamento remove evento", () => {
  const calendar = occupancyCalendar(2, [{ id: 5, inicio: "2026-11-19", fim: null }], "2028-11-19");
  assert.ok(calendar.includes("DTEND;VALUE=DATE:20281119"));
  assert.ok(!occupancyCalendar(2, [], "2028-11-19").includes("BEGIN:VEVENT"));
});
