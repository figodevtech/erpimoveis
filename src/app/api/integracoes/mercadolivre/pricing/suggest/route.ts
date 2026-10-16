import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { requireEmpresaId } from "@/lib/empresa-context";
import { MercadoLivreSiteSearchError, searchMercadoLivreSite } from "@/lib/integrations/mercadolivre-site-prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireVendasAccess();
    await requireEmpresaId();
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (q.length < 3 || q.length > 180) {
      return NextResponse.json({ error: "Informe um título entre 3 e 180 caracteres." }, { status: 400 });
    }
    const result = await searchMercadoLivreSite(q);
    return NextResponse.json({ ...result, count: result.data.length, source: "mercadolivre_public_html" }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof MercadoLivreSiteSearchError) {
      return NextResponse.json({ error: error.message, unavailable: true, data: [], averagePrice: null }, { status: error.status });
    }
    console.error("GET /api/integracoes/mercadolivre/pricing/suggest", error);
    return NextResponse.json({ error: "Não foi possível pesquisar os preços agora." }, { status: 500 });
  }
}
