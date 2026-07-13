import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess, requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { getMercadoLivreInvoiceState, sendMercadoLivreInvoice } from "@/lib/integrations/mercadolivre-invoice";
import { syncMercadoLivreShipmentForVenda } from "@/lib/integrations/mercadolivre-shipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParamsCtx = { params: Promise<{ orderId: string }> };

export async function GET(req: NextRequest, ctx: ParamsCtx) {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const orderId = parseOrderId((await ctx.params).orderId);
    const refreshRemote = req.nextUrl.searchParams.get("refresh") === "1";
    return NextResponse.json({ data: await getMercadoLivreInvoiceState(orderId, empresaId, refreshRemote) });
  } catch (error: any) {
    console.error("GET /api/integracoes/mercadolivre/orders/[orderId]/invoice", error);
    return NextResponse.json({ error: error?.message || "Falha ao consultar a NF-e do pedido." }, { status: errorStatus(error) });
  }
}

export async function POST(_req: NextRequest, ctx: ParamsCtx) {
  try {
    await requireVendasEdit();
    const empresaId = await requireEmpresaId();
    const orderId = parseOrderId((await ctx.params).orderId);
    const data = await sendMercadoLivreInvoice(orderId, empresaId);
    const shipment = data.vendaId
      ? await syncMercadoLivreShipmentForVenda(Number(data.vendaId), empresaId).catch((error) => {
          console.warn("NF-e enviada, mas o shipment ainda não atualizou", error);
          return null;
        })
      : null;
    return NextResponse.json({ data, shipment });
  } catch (error: any) {
    console.error("POST /api/integracoes/mercadolivre/orders/[orderId]/invoice", error);
    return NextResponse.json({ error: error?.message || "Falha ao enviar a NF-e ao Mercado Livre." }, { status: errorStatus(error) });
  }
}

function parseOrderId(value: string) {
  const orderId = Number(value);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    const error = new Error("Pedido Mercado Livre inválido.");
    (error as any).statusCode = 400;
    throw error;
  }
  return orderId;
}
