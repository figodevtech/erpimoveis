import { createHash } from "crypto";
import { getMercadoLivreOrder, mercadoLivreApiGet, refreshMercadoLivreToken, tokenExpiresAt } from "@/lib/integrations/mercadolivre";
import { importMercadoLivreOrder } from "@/lib/integrations/mercadolivre-orders";
import { syncMercadoLivreShipmentForVenda } from "@/lib/integrations/mercadolivre-shipping";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const MERCADO_PAGO_API_BASE_URL = "https://api.mercadopago.com";

type NotificationPayload = {
  topic?: string;
  resource?: string;
  user_id?: number;
  application_id?: number;
  attempts?: number;
  sent?: string;
  received?: string;
  [key: string]: unknown;
};

type Account = {
  id: number;
  empresa_id: number;
  ml_user_id: number;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};

export async function receiveMercadoLivreNotification(payload: NotificationPayload) {
  validateNotificationApplication(payload);
  const mlUserId = toNullableNumber(payload.user_id);
  const account = mlUserId ? await findAccountByUserId(mlUserId) : null;
  const dedupeKey = buildDedupeKey(payload);
  const notification = await insertOrGetNotification(account, payload, dedupeKey);

  if (String(notification.status).toUpperCase() === "PROCESSADA") {
    return { duplicate: true, notificationId: notification.id };
  }

  await processNotification(notification.id);
  return { duplicate: false, notificationId: notification.id };
}

export async function retryMercadoLivreNotifications(limit = 50) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_notification")
    .select("id")
    .in("status", ["RECEBIDA", "ERRO"])
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 100));

  if (error) throw error;

  const results = [];
  for (const notification of data ?? []) {
    try {
      await processNotification(Number(notification.id));
      results.push({ id: Number(notification.id), ok: true });
    } catch (error: any) {
      results.push({ id: Number(notification.id), ok: false, error: error?.message || "Falha ao reprocessar notificação." });
    }
  }
  return results;
}

async function processNotification(notificationId: number) {
  const { data: notification, error } = await supabaseAdmin
    .from("mercadolivre_notification")
    .select("id, account_id, ml_user_id, topic, resource, raw_payload, status, processing_attempts")
    .eq("id", notificationId)
    .single();

  if (error) throw error;
  if (String(notification.status).toUpperCase() === "PROCESSADA") return;

  const attempts = Number(notification.processing_attempts ?? 0) + 1;
  await supabaseAdmin
    .from("mercadolivre_notification")
    .update({ status: "PROCESSANDO", processing_attempts: attempts, error: null })
    .eq("id", notificationId);

  try {
    const account = await getNotificationAccount(notification.account_id, notification.ml_user_id);
    if (!account) throw new Error("Conta Mercado Livre não encontrada para a notificação.");
    const accessToken = await ensureValidAccessToken(account);
    const topic = String(notification.topic ?? "").toLowerCase();
    const resource = String(notification.resource ?? "");

    let finalStatus = "PROCESSADA";
    let finalError: string | null = null;

    if (topic === "orders_v2" || topic === "orders") {
      await processOrder(account, accessToken, resource);
    } else if (topic === "shipments") {
      await processShipment(account, accessToken, resource);
    } else if (topic === "items" || topic === "items_prices") {
      await processItem(account, accessToken, resource);
    } else if (topic.includes("claim") || topic.includes("reclama")) {
      await processClaim(account, accessToken, resource);
    } else if (topic === "questions") {
      await processQuestion(accessToken, resource);
    } else if (topic === "messages" || topic === "messaging") {
      await processMessage(accessToken, resource);
    } else if (topic === "payments") {
      await processPayment(account, accessToken, resource);
    } else if (topic.includes("feedback")) {
      await processFeedback(account, accessToken, resource);
    } else {
      finalStatus = "IGNORADA";
      finalError = `Tópico sem processador configurado: ${topic || "não informado"}.`;
    }

    const { error: updateError } = await supabaseAdmin
      .from("mercadolivre_notification")
      .update({
        status: finalStatus,
        error: finalError,
        processed_at: new Date().toISOString(),
        next_retry_at: null,
      })
      .eq("id", notificationId);
    if (updateError) throw updateError;
  } catch (error: any) {
    const retryMinutes = Math.min(2 ** Math.min(attempts, 6), 60);
    await supabaseAdmin
      .from("mercadolivre_notification")
      .update({
        status: "ERRO",
        error: String(error?.message || "Falha ao processar notificação.").slice(0, 2000),
        next_retry_at: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
      })
      .eq("id", notificationId);
    throw error;
  }
}

async function processQuestion(accessToken: string, resource: string) {
  if (!resource) throw new Error("Notificação de pergunta sem recurso.");
  await mercadoLivreApiGet(accessToken, normalizeResource(resource));
}

async function processMessage(accessToken: string, resource: string) {
  if (!resource) throw new Error("Notificação de mensagem sem recurso.");
  const separator = resource.includes("?") ? "&" : "?";
  const path = resource.includes("tag=") ? resource : `${resource}${separator}tag=post_sale`;
  await mercadoLivreApiGet(accessToken, normalizeResource(path));
}

async function processPayment(account: Account, accessToken: string, resource: string) {
  const paymentId = extractResourceId(resource);
  if (!paymentId) throw new Error("Notificação de pagamento sem payment_id.");
  const payment = await mercadoPagoApiGet(accessToken, `/v1/payments/${encodeURIComponent(paymentId)}`);
  const orderId = extractPaymentOrderId(payment);
  if (!orderId) return;
  const order = await getMercadoLivreOrder(accessToken, orderId);
  await importMercadoLivreOrder({ ...account, access_token: accessToken }, order);
}

async function processFeedback(account: Account, accessToken: string, resource: string) {
  const orderId = extractOrderId(resource);
  if (!orderId) throw new Error("Notificação de feedback sem order_id.");
  const order = await getMercadoLivreOrder(accessToken, orderId);
  await importMercadoLivreOrder({ ...account, access_token: accessToken }, order);
}

async function processOrder(account: Account, accessToken: string, resource: string) {
  const orderId = extractResourceId(resource);
  if (!orderId) throw new Error("Notificação de pedido sem order_id.");
  const order = await getMercadoLivreOrder(accessToken, orderId);
  await importMercadoLivreOrder({ ...account, access_token: accessToken }, order);
}

async function processShipment(account: Account, accessToken: string, resource: string) {
  const shipmentId = extractResourceId(resource);
  if (!shipmentId) throw new Error("Notificação de envio sem shipment_id.");
  const shipment = await mercadoLivreApiGet<any>(accessToken, `/shipments/${encodeURIComponent(shipmentId)}`);
  const orderId = Number(shipment?.order_id ?? shipment?.order?.id ?? 0);

  if (Number.isFinite(orderId) && orderId > 0) {
    const order = await getMercadoLivreOrder(accessToken, orderId);
    await importMercadoLivreOrder({ ...account, access_token: accessToken }, order);
    return;
  }

  const { data: storedOrder, error } = await supabaseAdmin
    .from("mercadolivre_order")
    .select("venda_id")
    .eq("empresa_id", account.empresa_id)
    .eq("ml_shipment_id", Number(shipmentId))
    .maybeSingle();
  if (error) throw error;
  if (!storedOrder?.venda_id) throw new Error(`Envio ${shipmentId} sem pedido vinculado no ERP.`);
  await syncMercadoLivreShipmentForVenda(Number(storedOrder.venda_id));
}

async function processItem(account: Account, accessToken: string, resource: string) {
  const itemId = extractResourceId(resource)?.toUpperCase();
  if (!itemId) throw new Error("Notificação de anúncio sem item_id.");
  const item = await mercadoLivreApiGet<any>(accessToken, `/items/${encodeURIComponent(itemId)}`);
  const { error } = await supabaseAdmin
    .from("mercadolivre_product_link")
    .update({
      status: item?.status ?? null,
      title: item?.title ?? null,
      permalink: item?.permalink ?? null,
      raw_item: item ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq("empresa_id", account.empresa_id)
    .eq("ml_item_id", itemId);
  if (error) throw error;
}

async function processClaim(account: Account, accessToken: string, resource: string) {
  const claimId = extractResourceId(resource);
  if (!claimId) throw new Error("Notificação de reclamação sem claim_id.");
  const claim = await mercadoPagoApiGet(accessToken, `/post-purchase/v1/claims/${encodeURIComponent(claimId)}`);
  const order = await findRelatedOrder(account.empresa_id, claim);
  if (!order) throw new Error(`Reclamação ${claimId} sem pedido vinculado no ERP.`);

  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin.from("mercadolivre_claim").upsert(
    {
      empresa_id: account.empresa_id,
      account_id: account.id,
      order_id: order.id,
      ml_order_id: order.ml_order_id,
      ml_shipment_id: order.ml_shipment_id ?? null,
      ml_claim_id: String(claim?.id ?? claimId),
      status: claim?.status ?? claim?.stage ?? null,
      stage: claim?.stage ?? null,
      claim_type: claim?.type ?? claim?.reason?.type ?? null,
      reason: claim?.reason?.name ?? claim?.reason?.description ?? claim?.reason_id ?? null,
      title: claim?.title ?? claim?.reason?.name ?? "Reclamação Mercado Livre",
      due_date: claim?.due_date ?? claim?.expiration_date ?? claim?.deadline ?? null,
      closed_at: claim?.closed_at ?? claim?.date_closed ?? (String(claim?.status ?? "").toLowerCase() === "closed" ? claim?.last_updated : null) ?? null,
      resolution: getClaimResolution(claim),
      available_actions: getClaimAvailableActions(claim),
      players: Array.isArray(claim?.players) ? claim.players : [],
      resource,
      raw_claim: claim ?? {},
      synced_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "ml_claim_id" },
  );
  if (error) throw error;
}

async function insertOrGetNotification(account: Account | null, payload: NotificationPayload, dedupeKey: string) {
  const row = {
    account_id: account?.id ?? null,
    topic: payload.topic ?? null,
    resource: payload.resource ?? null,
    ml_user_id: toNullableNumber(payload.user_id),
    application_id: toNullableNumber(payload.application_id),
    attempts: toNullableNumber(payload.attempts),
    sent: payload.sent ?? null,
    received: payload.received ?? null,
    dedupe_key: dedupeKey,
    raw_payload: payload,
    status: "RECEBIDA",
  };
  const { data, error } = await supabaseAdmin.from("mercadolivre_notification").insert(row).select("id, status").single();
  if (!error) return data;
  if (error.code !== "23505") throw error;

  const existing = await supabaseAdmin.from("mercadolivre_notification").select("id, status").eq("dedupe_key", dedupeKey).single();
  if (existing.error) throw existing.error;
  return existing.data;
}

function buildDedupeKey(payload: NotificationPayload) {
  const eventMarker = payload.sent || payload.received || JSON.stringify(payload);
  const source = [payload.topic, payload.resource, payload.user_id, payload.application_id, eventMarker].map((value) => String(value ?? "")).join("|");
  return createHash("sha256").update(source).digest("hex");
}

function extractResourceId(resource: string) {
  return resource.split("?")[0].split("/").filter(Boolean).pop() || null;
}

function extractOrderId(resource: string) {
  const match = resource.match(/\/orders\/(\d+)/i);
  return match ? Number(match[1]) : null;
}

function extractPaymentOrderId(payment: any) {
  const candidates = [
    payment?.order?.id,
    payment?.metadata?.order_id,
    payment?.metadata?.orderId,
    payment?.external_reference,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return null;
}

function normalizeResource(resource: string) {
  if (resource.startsWith("http://") || resource.startsWith("https://")) {
    const url = new URL(resource);
    return `${url.pathname}${url.search}`;
  }
  return resource.startsWith("/") ? resource : `/${resource}`;
}

function validateNotificationApplication(payload: NotificationPayload) {
  const configuredApplicationId = String(process.env.MERCADOLIVRE_CLIENT_ID ?? "").trim();
  const receivedApplicationId = String(payload.application_id ?? "").trim();
  if (configuredApplicationId && receivedApplicationId && configuredApplicationId !== receivedApplicationId) {
    throw new Error("Notificação recebida de uma aplicação Mercado Livre diferente.");
  }
}

async function findAccountByUserId(mlUserId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, ml_user_id, access_token, refresh_token, expires_at")
    .eq("ml_user_id", mlUserId)
    .maybeSingle();
  if (error) throw error;
  return data as Account | null;
}

async function getNotificationAccount(accountId: number | null, mlUserId: number | null) {
  let query = supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, ml_user_id, access_token, refresh_token, expires_at")
    .limit(1);
  if (accountId) query = query.eq("id", accountId);
  else if (mlUserId) query = query.eq("ml_user_id", mlUserId);
  else return null;

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data as Account | null;
}

async function ensureValidAccessToken(account: Account) {
  const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  if (!account.refresh_token || !expiresAt || expiresAt - Date.now() >= 5 * 60 * 1000) return account.access_token;

  const token = await refreshMercadoLivreToken(account.refresh_token);
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

async function findRelatedOrder(empresaId: number, claim: any) {
  const raw = JSON.stringify(claim ?? {});
  const resourceId = Number(claim?.resource_id ?? claim?.resource?.id ?? 0);
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_order")
    .select("id, ml_order_id, ml_shipment_id")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (
    (data ?? []).find((order: any) => Number(order.ml_shipment_id ?? 0) > 0 && Number(order.ml_shipment_id) === resourceId) ??
    (data ?? []).find((order: any) => Number(order.ml_order_id) === resourceId) ??
    (data ?? []).find((order: any) => raw.includes(String(order.ml_order_id))) ??
    null
  );
}

async function mercadoPagoApiGet(accessToken: string, path: string) {
  const response = await fetch(`${MERCADO_PAGO_API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Mercado Pago ${path} falhou (${response.status}): ${await response.text()}`);
  return response.json();
}

function getClaimResolution(claim: any) {
  const resolution = claim?.resolution ?? claim?.resolved_by ?? claim?.expected_resolution ?? null;
  if (!resolution) return null;
  if (typeof resolution === "string") return resolution;
  return resolution?.type ?? resolution?.status ?? resolution?.decision ?? resolution?.expected_resolution ?? resolution?.reason ?? null;
}

function getClaimAvailableActions(claim: any) {
  if (Array.isArray(claim?.available_actions)) return claim.available_actions;
  if (Array.isArray(claim?.actions)) return claim.actions;
  if (Array.isArray(claim?.available_resolutions)) return claim.available_resolutions;
  return (claim?.players ?? [])
    .filter((player: any) => player?.type === "seller" || player?.role === "respondent")
    .flatMap((player: any) => (Array.isArray(player?.available_actions) ? player.available_actions : []));
}

function toNullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
