import { NextResponse, type NextRequest } from "next/server";
import { requireVendasCreate } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { syncShopeeOrders } from "@/lib/integrations/shopee-orders";

export async function POST(req: NextRequest) {
  try {
    await requireVendasCreate();
    const empresaId = await requireEmpresaId();
    const body = await req.json().catch(() => ({}));
    const results = await syncShopeeOrders({ empresaId, accountId: body.accountId ? Number(body.accountId) : undefined, days: body.days ? Number(body.days) : undefined });
    return NextResponse.json({ ok: true, created: results.filter((row) => row.created).length, results });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Falha ao sincronizar pedidos Shopee." }, { status: errorStatus(error) });
  }
}
