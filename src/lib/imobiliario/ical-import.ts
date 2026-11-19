export type CalendarEvent = { uid: string; inicio: string; fim: string };

function civil(value: string) {
  // Os feeds de hospedagem usam dias inteiros. Outros formatos não podem liberar datas por aproximação.
  if (!/^\d{8}$/.test(value)) throw new Error("O calendário contém horários ou datas não suportados. Use o link iCal de hospedagem.");
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error("O calendário contém uma data inválida.");
  return date;
}

/** Um snapshot só é aplicado depois da leitura completa e validação de todos os eventos. */
export function parseOccupancyCalendar(source: string): CalendarEvent[] {
  if (source.length > 2_000_000) throw new Error("Calendário maior que o limite permitido.");
  const lines = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").trim().split("\n").map((line) => line.replace(/\r$/, ""));
  if (lines[0] !== "BEGIN:VCALENDAR" || lines.at(-1) !== "END:VCALENDAR" || !lines.includes("VERSION:2.0")) throw new Error("O endereço não retornou um calendário iCal válido.");
  if (lines.includes("METHOD:CANCEL")) throw new Error("O endereço retornou uma mensagem parcial, não um calendário completo.");
  const events = new Map<string, CalendarEvent>();
  let current: Map<string, string> | null = null;
  let count = 0;
  for (const line of lines.slice(1, -1)) {
    if (line === "BEGIN:VEVENT") {
      if (current) throw new Error("Calendário com eventos incompletos.");
      current = new Map();
      if (++count > 10000) throw new Error("Calendário com eventos demais.");
      continue;
    }
    if (line === "END:VEVENT") {
      if (!current) throw new Error("Calendário com eventos incompletos.");
      const uid = current.get("UID")?.trim();
      if (!uid || uid.length > 2000) throw new Error("Evento sem identificador válido.");
      if (current.has("RRULE") || current.has("RDATE") || current.has("RECURRENCE-ID") || current.has("EXDATE")) throw new Error("Calendários com recorrência não são suportados. Use o calendário de reservas do anúncio.");
      if (current.get("STATUS") !== "CANCELLED" && current.get("TRANSP") !== "TRANSPARENT" && !uid.endsWith("@erpimoveis")) {
        const start = civil(current.get("DTSTART") ?? "");
        const end = current.has("DTEND") ? civil(current.get("DTEND")!) : new Date(Date.parse(`${start}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
        if (current.has("DURATION") || end <= start) throw new Error("Evento com período inválido ou não suportado.");
        const previous = events.get(uid);
        if (previous && (previous.inicio !== start || previous.fim !== end)) throw new Error("Calendário com identificadores duplicados e períodos diferentes.");
        events.set(uid, { uid, inicio: start, fim: end });
      }
      current = null;
      continue;
    }
    if (current) {
      const colon = line.indexOf(":");
      if (colon < 1) throw new Error("Calendário com evento inválido.");
      const key = line.slice(0, colon).split(";")[0].toUpperCase();
      if (key === "BEGIN" || key === "END") throw new Error("Evento com componentes não suportados.");
      if (["UID", "DTSTART", "DTEND", "STATUS", "TRANSP", "RRULE", "RDATE", "RECURRENCE-ID", "EXDATE", "DURATION"].includes(key)) {
        if (current.has(key)) throw new Error("Evento com campos duplicados.");
        current.set(key, line.slice(colon + 1));
      }
    } else if (line === "END:VCALENDAR" || line === "BEGIN:VCALENDAR") throw new Error("Calendário com estrutura inválida.");
  }
  if (current) throw new Error("Calendário incompleto. As datas anteriores foram preservadas.");
  return [...events.values()];
}
