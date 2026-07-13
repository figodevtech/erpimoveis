import { NextResponse, type NextRequest } from "next/server";
import { requireVendasCreate } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { syncMercadoLivreOrders } from "@/lib/integrations/mercadolivre-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireVendasCreate();
    const empresaId = await requireEmpresaId();
    const body = await req.json().catch(() => ({}));
    const accountId = body?.accountId ? Number(body.accountId) : undefined;
    const days = body?.days ? Number(body.days) : undefined;
    const limit = body?.limit ? Number(body.limit) : undefined;

    const results = await syncMercadoLivreOrders({ accountId, empresaId, days, limit });
    const created = results.filter((item) => item.created).length;

    return NextResponse.json({ ok: true, created, results });
  } catch (e: any) {
    console.error("POST /api/integracoes/mercadolivre/sync-orders", e);
    return NextResponse.json({ error: e?.message || "Falha ao sincronizar pedidos Mercado Livre." }, { status: errorStatus(e) });
  }
}
