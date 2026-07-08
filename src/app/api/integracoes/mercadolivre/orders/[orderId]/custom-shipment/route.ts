import { NextResponse, type NextRequest } from "next/server";
import { requireVendasEdit } from "@/app/api/_authz/perms";
import { mercadoLivreApiGet, mercadoLivreApiPost, refreshMercadoLivreToken, tokenExpiresAt } from "@/lib/integrations/mercadolivre";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParamsCtx = { params: Promise<{ orderId: string }> };

type MercadoLivreAccount = {
  id: number;
  empresa_id: number;
  ml_user_id: number;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};

type MercadoLivreOrder = {
  id: number;
  empresa_id: number;
  account_id: number | null;
  venda_id: number | null;
  ml_order_id: number;
  ml_shipment_id: number | null;
  buyer_id: number | null;
  raw_order: any;
  raw_shipment: any;
};

export async function POST(req: NextRequest, ctx: ParamsCtx) {
  try {
    await requireVendasEdit();
    const { orderId } = await ctx.params;
    const id = Number(orderId);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const carrier = String(body?.carrier ?? "").trim().toUpperCase();
    const trackingCode = String(body?.trackingCode ?? "").trim();
    const trackingUrl = String(body?.trackingUrl ?? "").trim();
    const deadline = String(body?.deadline ?? "").trim();
    const notifyBuyer = body?.notifyBuyer !== false;
    const markAsShipped = body?.markAsShipped !== false;

    if (!carrier) {
      return NextResponse.json({ error: "Informe a transportadora." }, { status: 400 });
    }
    if (!trackingCode && !trackingUrl) {
      return NextResponse.json({ error: "Informe o código de rastreio ou o link de acompanhamento." }, { status: 400 });
    }

    if (markAsShipped && !trackingCode) {
      return NextResponse.json({ error: "Informe o código de rastreio para marcar o pedido como enviado no Mercado Livre." }, { status: 400 });
    }

    const order = await getOrder(id);
    if (!order) return NextResponse.json({ error: "Pedido Mercado Livre não encontrado." }, { status: 404 });

    const account = await getAccount(order);
    const accessToken = await ensureValidAccessToken(account);
    const finalTrackingUrl = trackingUrl || buildTrackingUrl(carrier, trackingCode);
    const message = buildTrackingMessage({
      mlOrderId: order.ml_order_id,
      carrier,
      trackingCode,
      trackingUrl: finalTrackingUrl,
      deadline,
    });

    const now = new Date().toISOString();
    const shipmentId = await resolveShipmentId(accessToken, order);
    let sellerNotification: any = null;
    if (markAsShipped) {
      sellerNotification = await markMercadoLivreShipmentAsShipped(accessToken, {
        shipmentId,
        carrier,
        trackingCode,
        trackingUrl: finalTrackingUrl,
        date: now,
      });
    }

    const rawShipment = {
      ...(order.raw_shipment && typeof order.raw_shipment === "object" ? order.raw_shipment : {}),
      id: shipmentId,
      status: markAsShipped ? "shipped" : order.raw_shipment?.status,
      substatus: markAsShipped ? null : order.raw_shipment?.substatus,
      custom: {
        carrier,
        tracking_code: trackingCode || null,
        tracking_url: finalTrackingUrl || null,
        deadline: deadline || null,
        notified_buyer_at: notifyBuyer ? now : null,
        marketplace_status_sent_at: markAsShipped ? now : null,
        seller_notification: sellerNotification,
      },
    };

    const { data: updatedOrder, error: orderError } = await supabaseAdmin
      .from("mercadolivre_order")
      .update({
        shipping_mode: "custom",
        logistic_type: "custom",
        ml_shipment_id: shipmentId,
        shipment_status: markAsShipped ? "shipped" : "ready_to_ship",
        shipment_substatus: null,
        tracking_number: trackingCode || null,
        tracking_method: carrier,
        raw_shipment: rawShipment,
        shipment_updated_at: now,
        updated_at: now,
      })
      .eq("id", order.id)
      .select("*")
      .single();

    if (orderError) throw orderError;

    if (order.venda_id) {
      const { error: vendaError } = await supabaseAdmin
        .from("venda")
        .update({
          status_entrega: "ENVIO",
          codigo_rastreio: trackingCode || null,
          transportadora_rastreio: carrier,
          status_rastreio: "POSTADO",
          rastreio_atualizado_em: now,
        })
        .eq("id", order.venda_id);

      if (vendaError) throw vendaError;
    }

    let messageSent = false;
    if (notifyBuyer) {
      await sendBuyerMessage(accessToken, account, order, message);
      messageSent = true;
    }

    return NextResponse.json({ ok: true, data: updatedOrder, messageSent, marketplaceStatusUpdated: markAsShipped, message });
  } catch (e: any) {
    console.error("POST /api/integracoes/mercadolivre/orders/[orderId]/custom-shipment", e);
    return NextResponse.json({ error: friendlyMercadoLivreError(e, "Falha ao registrar envio personalizado.") }, { status: 500 });
  }
}

async function getOrder(orderId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_order")
    .select("id, empresa_id, account_id, venda_id, ml_order_id, ml_shipment_id, buyer_id, raw_order, raw_shipment")
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw error;
  return data as MercadoLivreOrder | null;
}

async function getAccount(order: MercadoLivreOrder) {
  let query = supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, ml_user_id, access_token, refresh_token, expires_at")
    .eq("empresa_id", order.empresa_id);

  if (order.account_id) query = query.eq("id", order.account_id);

  const { data, error } = await query.order("updated_at", { ascending: false }).limit(1).single();
  if (error) throw error;
  return data as MercadoLivreAccount;
}

async function resolveShipmentId(accessToken: string, order: MercadoLivreOrder) {
  const existingId = Number(order.ml_shipment_id ?? order.raw_shipment?.id ?? order.raw_order?.shipping?.id ?? 0);
  if (Number.isFinite(existingId) && existingId > 0) return existingId;

  const response = await mercadoLivreApiGet<any>(accessToken, `/orders/${encodeURIComponent(String(order.ml_order_id))}/shipments`);
  const shipmentId = Number(response?.id ?? response?.shipment?.id ?? response?.results?.[0]?.id ?? 0);
  if (!Number.isFinite(shipmentId) || shipmentId <= 0) {
    throw new Error("Pedido sem shipment_id no Mercado Livre. Sincronize o pedido antes de marcar como enviado.");
  }
  return shipmentId;
}

async function markMercadoLivreShipmentAsShipped(
  accessToken: string,
  params: {
    shipmentId: number;
    carrier: string;
    trackingCode: string;
    trackingUrl: string;
    date: string;
  },
) {
  return mercadoLivreApiPost<any>(accessToken, `/shipments/${encodeURIComponent(String(params.shipmentId))}/seller_notifications`, {
    payload: {
      service_id: 11,
      comment: `Enviado por ${formatCarrierLabel(params.carrier)}`,
      date: params.date,
    },
    tracking_number: params.trackingCode || undefined,
    tracking_url: params.trackingUrl || undefined,
    status: "shipped",
    substatus: null,
  });
}

async function ensureValidAccessToken(account: MercadoLivreAccount) {
  const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  const shouldRefresh = Boolean(account.refresh_token && expiresAt && expiresAt - Date.now() < 5 * 60 * 1000);
  if (!shouldRefresh) return account.access_token;

  const token = await refreshMercadoLivreToken(account.refresh_token as string);
  const { error } = await supabaseAdmin
    .from("mercadolivre_account")
    .update({
      access_token: token.access_token,
      refresh_token: token.refresh_token ?? account.refresh_token,
      token_type: token.token_type ?? null,
      scope: token.scope ?? null,
      expires_at: tokenExpiresAt(token.expires_in),
      raw_token: token,
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);

  if (error) throw error;
  return token.access_token;
}

async function sendBuyerMessage(accessToken: string, account: MercadoLivreAccount, order: MercadoLivreOrder, text: string) {
  const packId = getPackId(order);
  const buyerId = Number(order.buyer_id ?? order.raw_order?.buyer?.id ?? 0);
  if (!packId || !buyerId) throw new Error("Pedido sem dados suficientes para avisar o comprador.");

  await mercadoLivreApiPost<any>(
    accessToken,
    `/messages/packs/${encodeURIComponent(String(packId))}/sellers/${encodeURIComponent(String(account.ml_user_id))}?tag=post_sale`,
    {
      from: { user_id: account.ml_user_id },
      to: { user_id: buyerId },
      text,
    },
  );
}

function getPackId(order: MercadoLivreOrder) {
  return order.raw_order?.pack_id || order.raw_order?.pack?.id || order.ml_order_id;
}

function buildTrackingUrl(carrier: string, trackingCode: string) {
  if (!trackingCode) return "";
  if (carrier === "CORREIOS") {
    return `https://rastreamento.correios.com.br/app/index.php?objeto=${encodeURIComponent(trackingCode)}`;
  }
  return "";
}

function formatCarrierLabel(carrier: string) {
  const labels: Record<string, string> = {
    CORREIOS: "Correios",
    JADLOG: "Jadlog",
    LOGGI: "Loggi",
    AZUL_CARGO: "Azul Cargo",
    GRUPO_SBF: "Grupo SBF",
    TRANSPORTADORA: "transportadora",
    RETIRADA: "retirada",
  };
  return labels[carrier] || carrier;
}

function buildTrackingMessage(params: {
  mlOrderId: number;
  carrier: string;
  trackingCode: string;
  trackingUrl: string;
  deadline: string;
}) {
  return [
    `Olá! O pedido ${params.mlOrderId} foi enviado.`,
    `Transportadora: ${params.carrier}.`,
    params.trackingCode ? `Código de rastreio: ${params.trackingCode}.` : "",
    params.trackingUrl ? `Acompanhe por este link: ${params.trackingUrl}` : "",
    params.deadline ? `Prazo informado: ${params.deadline}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function friendlyMercadoLivreError(error: any, fallback: string) {
  const raw = String(error?.message ?? "");
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) return raw || fallback;

  try {
    const parsed = JSON.parse(raw.slice(jsonStart));
    const causes = Array.isArray(parsed.cause) ? parsed.cause : Array.isArray(parsed.cause_list) ? parsed.cause_list : [];
    const details = causes.map((cause: any) => cause?.message || cause?.msg || cause?.cause || cause?.code).filter(Boolean).join("; ");
    return details || parsed.message || parsed.error || fallback;
  } catch {
    return raw || fallback;
  }
}
