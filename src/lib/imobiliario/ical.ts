/** Calendário público: somente datas, sem nomes, valores ou motivos internos. */
export function occupancyCalendar(
  propertyId: number,
  rows: { id: number; inicio: string; fim: string | null }[],
  until: string,
  now = new Date(),
) {
  const date = (value: string) => value.replace(/-/g, "");
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ERP Imoveis//Disponibilidade//PT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const row of rows) {
    const end = row.fim ?? until;
    if (end <= row.inicio) continue;
    lines.push("BEGIN:VEVENT", `UID:imovel-${propertyId}-ocupacao-${row.id}@erpimoveis`,
      `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${date(row.inicio)}`,
      `DTEND;VALUE=DATE:${date(end)}`, "SUMMARY:Indisponivel", "TRANSP:OPAQUE", "END:VEVENT");
  }
  return [...lines, "END:VCALENDAR", ""].join("\r\n");
}
