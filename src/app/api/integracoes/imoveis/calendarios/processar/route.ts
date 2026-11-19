import { createHash, timingSafeEqual } from "node:crypto";
import { syncCalendars } from "@/lib/imobiliario/calendar-sync";
import { json } from "@/lib/imobiliario/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;
async function process(request: Request) {
  const expected = globalThis.process.env.CRON_SECRET;
  const actual = request.headers.get("authorization") ?? "";
  if (!expected || !timingSafeEqual(createHash("sha256").update(actual).digest(), createHash("sha256").update(`Bearer ${expected}`).digest())) return json({ error: "Não autorizado." }, 401);
  try {
    const results = await syncCalendars();
    return json({ results, ok: results.every((r) => r.status !== "ERRO") });
  } catch { return json({ error: "Falha ao processar calendários. Os bloqueios anteriores foram preservados." }, 500); }
}
export { process as GET, process as POST };
