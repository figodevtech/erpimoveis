import { NextResponse } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireVendasAccess();

    const [{ data: accounts, error: accountsError }, { data: orders, error: ordersError }, { data: notifications, error: notificationsError }] =
      await Promise.all([
        supabaseAdmin
          .from("mercadolivre_account")
          .select("id, empresa_id, ml_user_id, nickname, site_id, scope, expires_at, refresh_token, updated_at")
          .order("updated_at", { ascending: false }),
        supabaseAdmin
          .from("mercadolivre_order")
          .select("id, empresa_id, venda_id, ml_order_id, status, status_detail, payment_status, payment_status_detail, order_tags, date_closed, total_amount, currency_id, date_created, ml_shipment_id, shipment_status, shipment_substatus, shipping_mode, logistic_type, tracking_number, tracking_method, shipment_cost, raw_order, raw_payments, raw_shipment, raw_shipment_costs, raw_shipment_items, shipment_updated_at, last_synced_at, created_at")
          .order("created_at", { ascending: false })
          .limit(20),
        supabaseAdmin
          .from("mercadolivre_notification")
          .select("id, topic, resource, ml_user_id, status, error, created_at")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

    if (accountsError) throw accountsError;
    if (ordersError) throw ordersError;
    if (notificationsError) throw notificationsError;

    return NextResponse.json({
      accounts: (accounts ?? []).map(({ refresh_token, ...account }: any) => ({
        ...account,
        needs_reconnect: !refresh_token,
      })),
      orders: orders ?? [],
      notifications: notifications ?? [],
    });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/dashboard", e);
    return NextResponse.json({ error: e?.message || "Falha ao carregar marketplace." }, { status: 500 });
  }
}
