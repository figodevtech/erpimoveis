import { NextResponse, type NextRequest } from "next/server";
import { syncMercadoLivreOrders } from "@/lib/integrations/mercadolivre-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const configuredSecret = process.env.MERCADOLIVRE_CRON_SECRET?.trim();
    if (configuredSecret) {
      const receivedSecret = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
      if (receivedSecret !== configuredSecret) {
        return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
      }
    }

    const results = await syncMercadoLivreOrders({ days: 2, limit: 50 });
    const created = results.filter((item) => item.created).length;

    return NextResponse.json({ ok: true, created, total: results.length });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/cron", e);
    return NextResponse.json({ error: e?.message || "Falha na rotina Mercado Livre." }, { status: 500 });
  }
}
