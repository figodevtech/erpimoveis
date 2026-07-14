import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { getMercadoLivreShipmentLabelForVenda } from "@/lib/integrations/mercadolivre-shipping";

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

    const label = await getMercadoLivreShipmentLabelForVenda(id, empresaId);
    return new NextResponse(label.body, {
      headers: {
        "Content-Type": label.contentType,
        "Content-Disposition": `inline; filename="mercado-envios-${label.shipmentId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/shipments/venda/[vendaId]/label", e);
    const message = e?.message || "Falha ao baixar etiqueta Mercado Envios.";
    const operationalConflict = /etiqueta|pagamento|logística|envio personalizado|Full/i.test(message);
    return NextResponse.json({ error: message }, { status: operationalConflict ? 409 : errorStatus(e) });
  }
}
