import { NextResponse, type NextRequest } from "next/server";
import { requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { mercadoLivreApiGet, mercadoLivreApiPost, mercadoLivreApiPut } from "@/lib/integrations/mercadolivre";
import { buildMercadoLivreMe1TrackingEvent } from "@/lib/integrations/mercadolivre-me1";
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
  site_id: string | null;
};

type MercadoLivreOrder = {
  id: number;
  empresa_id: number;
  account_id: number | null;
  venda_id: number | null;
  ml_order_id: number;
  ml_shipment_id: number | null;
  buyer_id: number | null;
  status: string | null;
  payment_status: string | null;
  payment_status_detail: string | null;
  order_tags: string[] | null;
  shipment_status: string | null;
  raw_order: any;
  raw_shipment: any;
};

export async function POST(req: NextRequest, ctx: ParamsCtx) {
  try {
    await requireVendasEdit();
    const empresaId = await requireEmpresaId();
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
    const requestedStatus = String(body?.deliveryStatus ?? "").trim().toLowerCase();
    const requestedSubstatus = String(body?.deliverySubstatus ?? "").trim().toLowerCase() || null;
    const targetStatus = requestedStatus || (markAsShipped ? "shipped" : null);

    if (targetStatus && !["shipped", "delivered", "not_delivered"].includes(targetStatus)) {
      return NextResponse.json({ error: "Status de entrega inválido." }, { status: 400 });
    }

    if (!carrier) {
      return NextResponse.json({ error: "Informe a transportadora." }, { status: 400 });
    }
    if (!trackingCode && !trackingUrl) {
      return NextResponse.json({ error: "Informe o código de rastreio ou o link de acompanhamento." }, { status: 400 });
    }

    if (targetStatus === "shipped" && !trackingCode) {
      return NextResponse.json({ error: "Informe o código de rastreio para marcar o pedido como enviado no Mercado Livre." }, { status: 400 });
    }

    const order = await getOrder(id, empresaId);
    if (!order) return NextResponse.json({ error: "Pedido Mercado Livre não encontrado." }, { status: 404 });
    await validateCustomShipmentOperation(order);

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
    const currentShipment = await mercadoLivreApiGet<any>(accessToken, `/shipments/${encodeURIComponent(String(shipmentId))}`);
    const shipmentMode = String(currentShipment?.mode || order.raw_shipment?.mode || "custom").toLowerCase();
    let sellerNotification: any = null;
    if (targetStatus) {
      sellerNotification = await updateMercadoLivreShipmentStatus(accessToken, {
        shipmentId,
        shipmentMode,
        siteId: account.site_id,
        receiverId: Number(currentShipment?.receiver_id ?? currentShipment?.receiver_address?.receiver_id ?? order.buyer_id),
        carrier,
        trackingCode,
        trackingUrl: finalTrackingUrl,
        deadline,
        date: now,
        status: targetStatus,
        substatus: requestedSubstatus,
      });
    }

    const confirmedShipment = targetStatus
      ? await mercadoLivreApiGet<any>(accessToken, `/shipments/${encodeURIComponent(String(shipmentId))}`)
      : currentShipment;
    const confirmedStatus = String(confirmedShipment?.status || currentShipment?.status || order.shipment_status || "pending").toLowerCase();
    const marketplaceStatusConfirmed = !targetStatus || confirmedStatus === targetStatus || (targetStatus === "shipped" && confirmedStatus === "delivered");

    const rawShipment = {
      ...(confirmedShipment && typeof confirmedShipment === "object" ? confirmedShipment : {}),
      ...(order.raw_shipment && typeof order.raw_shipment === "object" ? order.raw_shipment : {}),
      id: shipmentId,
      status: confirmedStatus,
      substatus: confirmedShipment?.substatus ?? null,
      custom: {
        carrier,
        tracking_code: trackingCode || null,
        tracking_url: finalTrackingUrl || null,
        deadline: deadline || null,
        notified_buyer_at: notifyBuyer ? now : null,
        marketplace_status_sent_at: targetStatus ? now : order.raw_shipment?.custom?.marketplace_status_sent_at ?? null,
        requested_status: targetStatus,
        requested_substatus: requestedSubstatus,
        seller_notification: sellerNotification,
        marketplace_status_confirmed: marketplaceStatusConfirmed,
      },
    };

    const { data: updatedOrder, error: orderError } = await supabaseAdmin
      .from("mercadolivre_order")
      .update({
        shipping_mode: shipmentMode,
        logistic_type: confirmedShipment?.logistic_type || (shipmentMode === "custom" ? "custom" : null),
        ml_shipment_id: shipmentId,
        shipment_status: confirmedStatus,
        shipment_substatus: confirmedShipment?.substatus ?? null,
        tracking_number: confirmedShipment?.tracking_number || trackingCode || null,
        tracking_method: confirmedShipment?.tracking_method || carrier,
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
          status_entrega: confirmedStatus === "delivered" ? "ENTREGUE" : marketplaceStatusConfirmed ? "ENVIO" : "SEPARACAO",
          codigo_rastreio: trackingCode || null,
          transportadora_rastreio: carrier,
          status_rastreio: confirmedStatus === "delivered" ? "ENTREGUE" : marketplaceStatusConfirmed ? "POSTADO" : "PRONTO_PARA_ENVIO",
          rastreio_atualizado_em: now,
        })
        .eq("id", order.venda_id);

      if (vendaError) throw vendaError;
    }

    let messageSent = false;
    let messageError: string | null = null;
    if (notifyBuyer) {
      try {
        await sendBuyerMessage(accessToken, account, order, message);
        messageSent = true;
      } catch (error: any) {
        messageError = friendlyMercadoLivreError(error, "Não foi possível enviar a mensagem ao comprador.");
      }
    }

    return NextResponse.json({
      ok: true,
      data: updatedOrder,
      messageSent,
      marketplaceStatusUpdated: Boolean(targetStatus),
      marketplaceStatusConfirmed,
      confirmedStatus,
      message,
      messageError,
    });
  } catch (e: any) {
    console.error("POST /api/integracoes/mercadolivre/orders/[orderId]/custom-shipment", e);
    return NextResponse.json({ error: friendlyMercadoLivreError(e, "Falha ao registrar envio personalizado.") }, { status: errorStatus(e) });
  }
}

async function getOrder(orderId: number, empresaId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_order")
    .select("id, empresa_id, account_id, venda_id, ml_order_id, status, payment_status, payment_status_detail, order_tags, ml_shipment_id, shipment_status, buyer_id, raw_order, raw_shipment")
    .eq("empresa_id", empresaId)
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw error;
  return data as MercadoLivreOrder | null;
}

async function validateCustomShipmentOperation(order: MercadoLivreOrder) {
  const states = [order.status, order.payment_status, order.payment_status_detail, ...(order.order_tags ?? [])]
    .map((value) => String(value ?? "").toLowerCase());
  const payment = String(order.payment_status ?? "").toLowerCase();
  if (payment && !["paid", "approved", "accredited"].includes(payment)) {
    throw new Error("O envio só pode ser registrado depois que o pagamento for aprovado.");
  }
  if (states.some((value) => value.includes("cancel") || value.includes("refund") || value.includes("charged_back"))) {
    throw new Error("Este pedido foi cancelado ou reembolsado e não pode ser marcado como enviado.");
  }
  if (String(order.shipment_status ?? "").toLowerCase() === "delivered") {
    throw new Error("Este pedido já consta como entregue no Mercado Livre.");
  }

  const { data: claims, error } = await supabaseAdmin
    .from("mercadolivre_claim")
    .select("status")
    .eq("empresa_id", order.empresa_id)
    .eq("ml_order_id", order.ml_order_id);
  if (error) throw error;
  const hasActiveClaim = (claims ?? []).some(
    (claim) => !["closed", "resolved", "cancelled", "canceled"].includes(String(claim.status ?? "").toLowerCase()),
  );
  if (hasActiveClaim) {
    throw new Error("Este pedido possui uma reclamação ativa. Resolva o pós-venda antes de registrar o envio.");
  }
}

async function getAccount(order: MercadoLivreOrder) {
  if (!order.account_id) throw new Error("Este pedido pertence a uma conta Mercado Livre anterior e não pode mais receber atualizações de envio.");
  let query = supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, ml_user_id, access_token, refresh_token, expires_at, site_id")
    .eq("empresa_id", order.empresa_id);

  query = query.eq("id", order.account_id);

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

async function updateMercadoLivreShipmentStatus(
  accessToken: string,
  params: {
    shipmentId: number;
    shipmentMode: string;
    siteId: string | null;
    receiverId: number;
    carrier: string;
    trackingCode: string;
    trackingUrl: string;
    deadline: string;
    date: string;
    status: string;
    substatus: string | null;
  },
) {
  if (params.shipmentMode === "custom") {
    if (!Number.isFinite(params.receiverId) || params.receiverId <= 0) {
      throw new Error("O envio personalizado não possui o comprador vinculado para confirmar a postagem.");
    }

    const speed = parseDeliverySpeedHours(params.deadline);
    return mercadoLivreApiPut<any>(accessToken, `/shipments/${encodeURIComponent(String(params.shipmentId))}`, {
      status: params.status,
      tracking_number: params.trackingCode,
      receiver_id: params.receiverId,
      comments: `Enviado por ${formatCarrierLabel(params.carrier)}`,
      ...(speed ? { speed } : {}),
    });
  }

  if (params.shipmentMode !== "me1") {
    throw new Error(
      `O envio retornou o modo ${params.shipmentMode || "não especificado"}. Somente envios custom ou ME1 podem ser marcados manualmente como enviados.`,
    );
  }

  const event = buildMercadoLivreMe1TrackingEvent({
    siteId: params.siteId,
    carrierLabel: formatCarrierLabel(params.carrier),
    date: params.date,
    trackingNumber: params.trackingCode,
    trackingUrl: params.trackingUrl,
    status: params.status,
    substatus: params.substatus,
  });

  return mercadoLivreApiPost<any>(
    accessToken,
    `/v2/shipments/${encodeURIComponent(String(params.shipmentId))}/seller_notifications`,
    event,
  );
}

function parseDeliverySpeedHours(value: string) {
  const amount = Number(String(value).match(/\d+/)?.[0] ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return /hora/i.test(value) ? Math.round(amount) : Math.round(amount * 24);
}

async function ensureValidAccessToken(account: MercadoLivreAccount) {
  return ensureMercadoLivreToken(account);
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
      to: { user_id: getMessageAgentId(account.site_id) },
      text,
    },
  );
}

function getMessageAgentId(siteId: string | null) {
  const agents: Record<string, number> = {
    MLA: 3037674934,
    MLB: 3037675074,
    MLC: 3020819166,
    MCO: 3037204123,
    MLM: 3037204279,
    MLU: 3037204685,
  };
  return agents[String(siteId || "MLB").toUpperCase()] ?? agents.MLU;
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
import { ensureMercadoLivreToken } from "@/lib/integrations/mercadolivre-token";
