import { NextResponse } from "next/server";
import { requireConfigEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { buildMercadoLivreAuthorizationUrl } from "@/lib/integrations/mercadolivre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireConfigEdit();
    const empresaId = await requireEmpresaId();
    return NextResponse.redirect(buildMercadoLivreAuthorizationUrl({ empresaId }));
  } catch (error: any) {
    console.error("GET /api/integracoes/mercadolivre/auth", error);
    return NextResponse.json(
      { error: error?.message || "Falha ao iniciar autorização Mercado Livre." },
      { status: errorStatus(error) },
    );
  }
}
