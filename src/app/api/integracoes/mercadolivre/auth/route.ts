import { NextResponse, type NextRequest } from "next/server";
import { buildMercadoLivreAuthorizationUrl } from "@/lib/integrations/mercadolivre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const empresaIdParam = req.nextUrl.searchParams.get("empresaId");
    const empresaId = empresaIdParam ? Number(empresaIdParam) : undefined;

    if (empresaIdParam && (!Number.isInteger(empresaId) || Number(empresaId) <= 0)) {
      return NextResponse.json({ error: "empresaId invalido." }, { status: 400 });
    }

    return NextResponse.redirect(buildMercadoLivreAuthorizationUrl({ empresaId }));
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/auth", e);
    return NextResponse.json({ error: e?.message || "Falha ao iniciar autorizacao Mercado Livre." }, { status: 500 });
  }
}
