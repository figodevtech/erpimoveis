import { NextResponse } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();

    const { data: accounts, error: accountsError } = await supabaseAdmin
      .from("mercadolivre_account")
      .select("id")
      .eq("empresa_id", empresaId);
    if (accountsError) throw accountsError;

    const accountIds = (accounts ?? []).map((account: any) => Number(account.id)).filter(Number.isFinite);
    if (accountIds.length === 0) {
      return NextResponse.json({ revision: "empty" }, { headers: { "Cache-Control": "no-store" } });
    }

    const { data: orders, error } = await supabaseAdmin
      .from("mercadolivre_order")
      .select("id, status, payment_status, shipment_status, shipment_substatus, invoice_status, import_status, last_synced_at, shipment_updated_at, created_at")
      .eq("empresa_id", empresaId)
      .in("account_id", accountIds)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;

    return NextResponse.json(
      { revision: buildRevision(orders ?? []) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    console.error("GET /api/integracoes/mercadolivre/orders/revision", error);
    return NextResponse.json(
      { error: error?.message || "Não foi possível verificar atualizações dos pedidos." },
      { status: errorStatus(error) },
    );
  }
}

function buildRevision(orders: any[]) {
  if (orders.length === 0) return "empty";
  return orders
    .map((order) =>
      [
        order.id,
        order.status,
        order.payment_status,
        order.shipment_status,
        order.shipment_substatus,
        order.invoice_status,
        order.import_status,
        order.last_synced_at,
        order.shipment_updated_at,
        order.created_at,
      ]
        .map((value) => String(value ?? ""))
        .join(":"),
    )
    .join("|");
}
