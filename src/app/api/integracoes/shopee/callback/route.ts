import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decodeShopeeOAuthContext, exchangeShopeeCode, shopeeShopApi, shopeeTokenExpiresAt } from "@/lib/integrations/shopee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const context = decodeShopeeOAuthContext(req.cookies.get("shopee_oauth_context")?.value);
    if (!context) return html("Shopee", "Autorização inválida ou expirada. Inicie a conexão novamente pelo ERP.", 400);
    const code = req.nextUrl.searchParams.get("code")?.trim();
    const shopId = Number(req.nextUrl.searchParams.get("shop_id"));
    if (!code || !Number.isInteger(shopId) || shopId <= 0) return html("Shopee", "Código ou loja ausente no retorno da Shopee.", 400);

    const token = await exchangeShopeeCode(code, shopId);
    const shop = await shopeeShopApi<{ response?: { shop_name?: string; region?: string }; shop_name?: string; region?: string }>({
      path: "/api/v2/shop/get_shop_info",
      accessToken: token.access_token,
      shopId,
    }).catch(() => null);
    const shopInfo = shop?.response ?? shop ?? {};
    const { error } = await supabaseAdmin.from("shopee_account").upsert({
      empresa_id: context.empresaId,
      shop_id: shopId,
      shop_name: shopInfo.shop_name ?? null,
      region: shopInfo.region ?? "BR",
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: shopeeTokenExpiresAt(token.expire_in),
      raw_token: token,
      raw_shop: shopInfo,
      updated_at: new Date().toISOString(),
    }, { onConflict: "empresa_id" });
    if (error) throw error;
    return clearCookie(html("Shopee conectada", `Loja ${shopInfo.shop_name || shopId} vinculada com sucesso.`, 200, true));
  } catch (error: any) {
    console.error("GET /api/integracoes/shopee/callback", error);
    return clearCookie(html("Shopee", error?.message || "Falha ao concluir autorização.", 500));
  }
}

function html(title: string, message: string, status = 200, redirectToSettings = false) {
  const redirect = redirectToSettings
    ? `<meta http-equiv="refresh" content="2;url=/configuracoes/geral?integracao=shopee&status=connected"><script>setTimeout(function(){location.href='/configuracoes/geral?integracao=shopee&status=connected'},1500)</script>`
    : "";
  return new NextResponse(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title>${redirect}</head><body style="font-family:Arial,sans-serif;margin:40px;color:#111827"><main style="max-width:680px"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p>${redirectToSettings ? "Redirecionando para as configurações do ERP..." : "Volte ao ERP para tentar novamente."}</p><p><a href="/configuracoes/geral">Abrir Configurações Gerais</a></p></main></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function clearCookie(response: NextResponse) {
  response.cookies.set("shopee_oauth_context", "", { path: "/api/integracoes/shopee/callback", maxAge: 0 });
  return response;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] || char);
}
