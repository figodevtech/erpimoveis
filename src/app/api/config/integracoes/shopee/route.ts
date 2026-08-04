import { NextResponse } from "next/server";
import { requireConfigAccess, requireConfigEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireConfigAccess();
    const empresaId = await requireEmpresaId();
    const { data, error } = await supabaseAdmin
      .from("shopee_account")
      .select("id, empresa_id, shop_id, shop_name, region, expires_at, refresh_token, updated_at")
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (error) throw error;

    const missing = ["SHOPEE_PARTNER_ID", "SHOPEE_PARTNER_KEY", "SHOPEE_REDIRECT_URI"]
      .filter((key) => !process.env[key]?.trim());
    return NextResponse.json({
      configured: missing.length === 0,
      missing,
      account: data ? {
        id: data.id,
        empresaId: data.empresa_id,
        shopId: data.shop_id,
        shopName: data.shop_name,
        region: data.region,
        expiresAt: data.expires_at,
        updatedAt: data.updated_at,
        needsReconnect: !data.refresh_token,
      } : null,
    });
  } catch (error: any) {
    console.error("GET /api/config/integracoes/shopee", error);
    return NextResponse.json({ error: error?.message || "Falha ao carregar configuração da Shopee." }, { status: errorStatus(error) });
  }
}

export async function DELETE() {
  try {
    await requireConfigEdit();
    const empresaId = await requireEmpresaId();
    const { data: account, error: accountError } = await supabaseAdmin
      .from("shopee_account")
      .select("id")
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) return NextResponse.json({ ok: true });

    const { error: detachError } = await supabaseAdmin
      .from("shopee_order")
      .update({ account_id: null, updated_at: new Date().toISOString() })
      .eq("account_id", account.id);
    if (detachError) throw detachError;

    const { error: linksError } = await supabaseAdmin
      .from("shopee_product_link")
      .delete()
      .eq("empresa_id", empresaId);
    if (linksError) throw linksError;

    const { error: deleteError } = await supabaseAdmin.from("shopee_account").delete().eq("id", account.id);
    if (deleteError) throw deleteError;
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("DELETE /api/config/integracoes/shopee", error);
    return NextResponse.json({ error: error?.message || "Falha ao desconectar a loja Shopee." }, { status: errorStatus(error) });
  }
}
