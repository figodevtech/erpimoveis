import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess, requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { syncMercadoLivreShipmentForVenda } from "@/lib/integrations/mercadolivre-shipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParamsCtx = { params: Promise<{ vendaId: string }> };

export async function GET(_req: NextRequest, ctx: ParamsCtx) {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const { vendaId } = await ctx.params;
    const id = Number(vendaId);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "vendaId inválido." }, { status: 400 });
    }

    const data = await syncMercadoLivreShipmentForVenda(id, empresaId);
    return NextResponse.json({ data });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/shipments/venda/[vendaId]", e);
    return NextResponse.json({ error: e?.message || "Falha ao sincronizar Mercado Envios." }, { status: errorStatus(e) });
  }
}

export async function POST(_req: NextRequest, ctx: ParamsCtx) {
  try {
    await requireVendasEdit();
    const empresaId = await requireEmpresaId();
    const { vendaId } = await ctx.params;
    const id = Number(vendaId);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "vendaId inválido." }, { status: 400 });
    }

    const data = await syncMercadoLivreShipmentForVenda(id, empresaId);
    return NextResponse.json({ data });
  } catch (e: any) {
    console.error("POST /api/integracoes/mercadolivre/shipments/venda/[vendaId]", e);
    return NextResponse.json({ error: e?.message || "Falha ao sincronizar Mercado Envios." }, { status: errorStatus(e) });
  }
}
