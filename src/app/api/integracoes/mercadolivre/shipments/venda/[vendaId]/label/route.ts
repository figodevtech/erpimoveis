import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { getMercadoLivreShipmentLabelForVenda } from "@/lib/integrations/mercadolivre-shipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParamsCtx = { params: Promise<{ vendaId: string }> };

export async function GET(_req: NextRequest, ctx: ParamsCtx) {
  try {
    await requireVendasAccess();
    const { vendaId } = await ctx.params;
    const id = Number(vendaId);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "vendaId inválido." }, { status: 400 });
    }

    const label = await getMercadoLivreShipmentLabelForVenda(id);
    return new NextResponse(label.body, {
      headers: {
        "Content-Type": label.contentType,
        "Content-Disposition": `inline; filename="mercado-envios-${label.shipmentId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/shipments/venda/[vendaId]/label", e);
    return NextResponse.json({ error: e?.message || "Falha ao baixar etiqueta Mercado Envios." }, { status: 500 });
  }
}
