import { NextResponse } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getShopeeGatewayConfig } from "@/lib/integrations/shopee";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const [{ data: accounts, error: accountError }, { data: orders, error: orderError }, { data: links, error: linksError }] = await Promise.all([
      supabaseAdmin.from("shopee_account").select("id, empresa_id, shop_id, shop_name, region, expires_at, updated_at").eq("empresa_id", empresaId).order("updated_at", { ascending: false }),
      supabaseAdmin.from("shopee_order").select("id, venda_id, order_sn, status, buyer_username, currency, total_amount, payment_method, tracking_number, shipping_carrier, create_time, update_time, import_status, import_error, last_synced_at, raw_order").eq("empresa_id", empresaId).order("create_time", { ascending: false }).limit(100),
      supabaseAdmin.from("shopee_product_link").select("id, produto_id, item_id, model_id, item_sku, model_sku, title, status, last_synced_at").eq("empresa_id", empresaId).order("updated_at", { ascending: false }),
    ]);
    if (accountError) throw accountError;
    if (orderError) throw orderError;
    if (linksError) throw linksError;
    const gateway = getShopeeGatewayConfig();
    return NextResponse.json({
      accounts: accounts ?? [],
      orders: orders ?? [],
      links: links ?? [],
      configuration: {
        ready: gateway.configured,
        missing: gateway.missing,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Falha ao carregar Shopee." }, { status: errorStatus(error) });
  }
}
