import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOccupancyCalendar } from "./ical-import";
import { occupancyCalendar } from "./ical";
const calendar = (events: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}END:VCALENDAR\r\n`;
const event = (uid = "reservation-1", start = "20261224", end = "20261226", extra = "") => `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART;VALUE=DATE:${start}\r\nDTEND;VALUE=DATE:${end}\r\n${extra}END:VEVENT\r\n`;

test("datas civis, saída exclusiva, UID dobrado e cancelamentos", () => {
  const result = parseOccupancyCalendar(calendar(event("reser\r\n vation-1")));
  assert.deepEqual(result, [{ uid: "reservation-1", inicio: "2026-12-24", fim: "2026-12-26" }]);
  assert.deepEqual(parseOccupancyCalendar(calendar(event("cancelled", undefined, undefined, "STATUS:CANCELLED\r\n"))), []);
  assert.deepEqual(parseOccupancyCalendar(calendar(event("transparent", undefined, undefined, "TRANSP:TRANSPARENT\r\n"))), []);
  assert.deepEqual(parseOccupancyCalendar(calendar("")), []);
});
test("ignora eventos exportados pelo próprio ERP para não realimentar os canais", () => {
  const own = occupancyCalendar(1, [{ id: 123, inicio: "2026-12-24", fim: "2026-12-26" }], "2028-01-01");
  assert.deepEqual(parseOccupancyCalendar(own), []);
});
test("recusa snapshots truncados, HTML, recorrência e eventos inválidos antes de aplicar cancelamentos", () => {
  for (const source of ["<html>login</html>", calendar(event()).replace("END:VEVENT", ""), calendar(event("x", "20260230")),
    calendar(event("x", "20261226", "20261224")), calendar(event("x", undefined, undefined, "RRULE:FREQ=DAILY\r\n")),
    calendar(event("x", "20261224T140000Z")), calendar(event("x") + event("x", "20261225")),
    calendar(event()).replace("VERSION:2.0", "VERSION:2.0\r\nMETHOD:CANCEL")]) assert.throws(() => parseOccupancyCalendar(source));
});
test("Airbnb: separa reserva (com código HM) de bloqueio, sem guardar telefone nem descrição", () => {
  const source = calendar(
    event("res@airbnb.com", "20261120", "20261122", "SUMMARY:Reserved\r\nDESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABC12345\\nPhone Number (Last 4 Digits): 9876\r\n") +
    event("blk@airbnb.com", "20261210", "20261214", "SUMMARY:Airbnb (Not available)\r\n") +
    event("old@airbnb.com", "20261215", "20261216", "SUMMARY:Maria Silva (HMOLD54321)\r\n"),
  );
  const result = parseOccupancyCalendar(source, "AIRBNB");
  assert.deepEqual(result, [
    { uid: "res@airbnb.com", inicio: "2026-11-20", fim: "2026-11-22", tipo: "RESERVA", codigo: "HMABC12345" },
    { uid: "blk@airbnb.com", inicio: "2026-12-10", fim: "2026-12-14", tipo: "BLOQUEIO" },
    { uid: "old@airbnb.com", inicio: "2026-12-15", fim: "2026-12-16", tipo: "RESERVA", codigo: "HMOLD54321" },
  ]);
  assert.ok(!JSON.stringify(result).includes("9876") && !JSON.stringify(result).includes("Maria"));
  // Sem o canal (Booking, Stays) o evento continua só com o período.
  assert.deepEqual(parseOccupancyCalendar(source)[0], { uid: "res@airbnb.com", inicio: "2026-11-20", fim: "2026-11-22" });
  assert.deepEqual(parseOccupancyCalendar(calendar(event("r", undefined, undefined, "SUMMARY:Reserved\r\n")), "AIRBNB")[0].tipo, "RESERVA");
});
test("evento DATE sem fim ocupa uma noite e não armazena nomes ou descrição", () => {
  const source = calendar("BEGIN:VEVENT\r\nUID:one\r\nDTSTART;VALUE=DATE:20261231\r\nSUMMARY:Nome privado\r\nDESCRIPTION:Informação privada\r\nEND:VEVENT\r\n");
  assert.deepEqual(parseOccupancyCalendar(source), [{ uid: "one", inicio: "2026-12-31", fim: "2027-01-01" }]);
});
