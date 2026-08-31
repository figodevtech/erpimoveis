import { NextRequest, NextResponse } from "next/server";
import { requireVendasAccess, requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { shopeeShopApi } from "@/lib/integrations/shopee";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const orderSn = requiredOrderSn(request.nextUrl.searchParams.get("orderSn"));
    await requireLocalOrder(empresaId, orderSn);
    const result = await shopeeShopApi<any>({
      path: "/api/v2/logistics/get_shipping_parameter",
      query: { order_sn: orderSn },
    });
    return NextResponse.json({ orderSn, parameter: result?.response ?? result });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyShippingError(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireVendasEdit();
    const empresaId = await requireEmpresaId();
    const body = await request.json().catch(() => ({}));
    const orderSn = requiredOrderSn(body.orderSn);
    await requireLocalOrder(empresaId, orderSn);

    const method = String(body.method || "").toLowerCase();
    const shipping: Record<string, unknown> = { order_sn: orderSn };
    if (method === "pickup") {
      const addressId = positiveInteger(body.addressId);
      const pickupTimeId = String(body.pickupTimeId || "").trim();
      if (!addressId || !pickupTimeId) return NextResponse.json({ error: "Selecione o endereço e o horário da coleta." }, { status: 400 });
      shipping.pickup = { address_id: addressId, pickup_time_id: pickupTimeId };
    } else if (method === "dropoff") {
      const branchId = positiveInteger(body.branchId);
      const senderRealName = String(body.senderRealName || "").trim();
      shipping.dropoff = {
        ...(branchId ? { branch_id: branchId } : {}),
        ...(senderRealName ? { sender_real_name: senderRealName.slice(0, 100) } : {}),
      };
    } else if (method === "non_integrated") {
      const trackingNumber = String(body.trackingNumber || "").trim();
      if (!trackingNumber) return NextResponse.json({ error: "Informe o código de rastreio." }, { status: 400 });
      shipping.non_integrated = { tracking_number: trackingNumber.slice(0, 100) };
    } else {
      return NextResponse.json({ error: "Selecione uma forma de envio disponibilizada pela Shopee." }, { status: 400 });
    }

    const shipped = await shopeeShopApi<any>({ path: "/api/v2/logistics/ship_order", method: "POST", body: shipping });
    const tracking = await shopeeShopApi<any>({
      path: "/api/v2/logistics/get_tracking_number",
      query: { order_sn: orderSn, response_optional_fields: "first_mile_tracking_number,last_mile_tracking_number" },
    }).catch(() => null);
    const trackingNumber = String(
      tracking?.response?.tracking_number
      || tracking?.response?.first_mile_tracking_number
      || tracking?.response?.last_mile_tracking_number
      || body.trackingNumber
      || "",
    ).trim();
    await supabaseAdmin.from("shopee_order").update({
      ...(trackingNumber ? { tracking_number: trackingNumber } : {}),
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("empresa_id", empresaId).eq("order_sn", orderSn);
    return NextResponse.json({ ok: true, shipped: shipped?.response ?? shipped, tracking: tracking?.response ?? null });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyShippingError(error) }, { status: errorStatus(error) });
  }
}

async function requireLocalOrder(empresaId: number, orderSn: string) {
  const { data, error } = await supabaseAdmin.from("shopee_order").select("id, status").eq("empresa_id", empresaId).eq("order_sn", orderSn).maybeSingle();
  if (error) throw error;
  if (!data) {
    const notFound = new Error("Pedido Shopee não encontrado nesta empresa.");
    (notFound as any).statusCode = 404;
    throw notFound;
  }
  return data;
}

function requiredOrderSn(value: unknown) {
  const orderSn = String(value || "").trim();
  if (!orderSn || orderSn.length > 80) {
    const error = new Error("Pedido Shopee inválido.");
    (error as any).statusCode = 400;
    throw error;
  }
  return orderSn;
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function friendlyShippingError(error: any) {
  const message = String(error?.message || "Falha ao preparar o envio na Shopee.");
  if (/already.*ship|already.*pickup|already.*dropoff/i.test(message)) return "Este pedido já teve o envio preparado na Shopee.";
  if (/not.*ready|status/i.test(message)) return `A Shopee não permite preparar este pedido no status atual. ${message}`;
  return message.replace(/^Shopee \/api\/v2\/[^:]+:\s*/i, "");
}
