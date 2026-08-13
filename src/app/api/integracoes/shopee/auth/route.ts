import { NextResponse, type NextRequest } from "next/server";
import { requireConfigEdit } from "@/app/api/_authz/perms";
import { errorStatus } from "@/lib/empresa-context";
import { createShopeeAuthorization } from "@/lib/integrations/shopee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireConfigEdit();
    const configuredOrigin = process.env.APP_URL?.trim().replace(/\/$/, "");
    const origin = configuredOrigin || request.nextUrl.origin;
    const returnUrl = new URL("/configuracoes/geral", origin).toString();
    const authorization = await createShopeeAuthorization(returnUrl);
    return NextResponse.redirect(authorization.authorization_url);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Falha ao iniciar autorização Shopee." }, { status: errorStatus(error) });
  }
}
