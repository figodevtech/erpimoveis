import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { refreshSiteRefundStatus } from "@/lib/integrations/site-refund-status";
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireEmpresaId } from "@/lib/empresa-context";
import { syncSiteOrders } from "@/lib/integrations/site-order-sync";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: Request) {
  const expected = process.env.STOREFRONT_ORDER_SYNC_SECRET?.trim() || "";
  const received = request.headers.get("authorization")?.replace(/^Bearer /, "").trim() || "";
  const a = Buffer.from(expected), b = Buffer.from(received);
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a,b)) return NextResponse.json({ error: "NAO_AUTORIZADO" }, { status: 401 });
  try {
    const body = await request.json();
    const orderId = Number(body.orderId);
    if(!Number.isSafeInteger(orderId) || orderId <= 0) return NextResponse.json({error:"PEDIDO_INVALIDO"},{status:400});
    const empresaId = await requireEmpresaId();
    const {data: link,error} = await supabaseAdmin.from("site_order_link").select("id").eq("empresa_id",empresaId).eq("site_order_id",orderId).maybeSingle();
    if(error) throw error;
    if(link) await refreshSiteRefundStatus(empresaId,orderId);
    const result = await syncSiteOrders(empresaId, orderId);
    return NextResponse.json(result, { status: result.errors ? 502 : 200 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao importar pedido." }, { status: 502 }); }
}
