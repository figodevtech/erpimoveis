import { identifier, imobFailure, internal, json } from "@/lib/imobiliario/server";
import { syncCalendars } from "@/lib/imobiliario/calendar-sync";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await internal("imoveis:editar");
    const results = await syncCalendars(identifier((await context.params).id));
    return json({ results });
  } catch (error) { return imobFailure(error); }
}
