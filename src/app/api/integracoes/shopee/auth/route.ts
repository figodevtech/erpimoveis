import { NextResponse } from "next/server";
import { requireConfigEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { buildShopeeAuthorizationUrl, encodeShopeeOAuthContext } from "@/lib/integrations/shopee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireConfigEdit();
    const empresaId = await requireEmpresaId();
    const response = NextResponse.redirect(buildShopeeAuthorizationUrl());
    response.cookies.set("shopee_oauth_context", encodeShopeeOAuthContext(empresaId), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/integracoes/shopee/callback",
      maxAge: 15 * 60,
    });
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Falha ao iniciar autorização Shopee." }, { status: errorStatus(error) });
  }
}
