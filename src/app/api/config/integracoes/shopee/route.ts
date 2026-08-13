import { NextResponse } from "next/server";
import { requireConfigAccess, requireConfigEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { disconnectShopeeGateway, getShopeeGatewayConfig, getShopeeGatewayConnection } from "@/lib/integrations/shopee";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireConfigAccess();
    const empresaId = await requireEmpresaId();
    const localConfig = getShopeeGatewayConfig();
    if (!localConfig.configured) {
      return NextResponse.json({ configured: false, missing: localConfig.missing, account: null });
    }

    const connection = await getShopeeGatewayConnection();
    let localAccount = null;
    if (connection.account) {
      const { data, error } = await supabaseAdmin.from("shopee_account").upsert({
        empresa_id: empresaId,
        shop_id: connection.account.shop_id,
        shop_name: connection.account.shop_name,
        region: connection.account.region || "BR",
        // O schema legado exige os campos, mas credenciais reais permanecem
        // criptografadas exclusivamente na Figo Central.
        access_token: "",
        refresh_token: "",
        expires_at: connection.account.expires_at,
        updated_at: new Date().toISOString(),
      }, { onConflict: "empresa_id" }).select("id, empresa_id, shop_id, shop_name, region, expires_at, updated_at").single();
      if (error) throw error;
      localAccount = data;
    }

    return NextResponse.json({
      configured: connection.configured,
      missing: connection.missing,
      account: localAccount ? {
        id: localAccount.id,
        empresaId: localAccount.empresa_id,
        shopId: localAccount.shop_id,
        shopName: localAccount.shop_name,
        region: localAccount.region,
        expiresAt: localAccount.expires_at,
        updatedAt: localAccount.updated_at,
        needsReconnect: connection.account?.status !== "ACTIVE",
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
    await disconnectShopeeGateway();
    const { data: account, error: accountError } = await supabaseAdmin
      .from("shopee_account")
      .select("id")
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) return NextResponse.json({ ok: true });

    const { error: detachError } = await supabaseAdmin.from("shopee_order")
      .update({ account_id: null, updated_at: new Date().toISOString() })
      .eq("account_id", account.id);
    if (detachError) throw detachError;
    const { error: linksError } = await supabaseAdmin.from("shopee_product_link").delete().eq("empresa_id", empresaId);
    if (linksError) throw linksError;
    const { error: deleteError } = await supabaseAdmin.from("shopee_account").delete().eq("id", account.id);
    if (deleteError) throw deleteError;
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("DELETE /api/config/integracoes/shopee", error);
    return NextResponse.json({ error: error?.message || "Falha ao desconectar a loja Shopee." }, { status: errorStatus(error) });
  }
}
