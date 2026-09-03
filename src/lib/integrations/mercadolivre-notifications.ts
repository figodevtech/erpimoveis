import { createHash } from "crypto";
import { getMercadoLivreOrder, mercadoLivreApiGet, mercadoLivreTokenMetadata, refreshMercadoLivreToken, tokenExpiresAt } from "@/lib/integrations/mercadolivre";
import { importMercadoLivreOrder } from "@/lib/integrations/mercadolivre-orders";
import { syncMercadoLivreShipmentForVenda } from "@/lib/integrations/mercadolivre-shipping";
import { applyMercadoLivrePriceToErp, getMercadoLivrePriceState } from "@/lib/integrations/mercadolivre-price-sync";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mercadoLivreSystemNotification } from "@/lib/integrations/mercadolivre-system-notification";
import { notifySalesUsers } from "@/lib/system-notifications";
import { processTelegramMarketplaceNotifications } from "@/lib/integrations/telegram-marketplace-notifications";


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
  if (!mlUserId) return { ignored: true, queued: false, reason: "Notificação sem usuário vendedor." };
  const { data: activeAccount, error: accountError } = await supabaseAdmin
    .from("mercadolivre_account")
    .select("id")
    .eq("ml_user_id", mlUserId)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!activeAccount) return { ignored: true, queued: false, reason: "Conta vendedora não vinculada a este ERP." };

  const dedupeKey = buildDedupeKey(payload);
  const notification = await insertOrGetNotification(payload, dedupeKey, Number(activeAccount.id));
  return { duplicate: notification.duplicate, queued: true, notificationId: notification.id };
}

export async function syncMercadoLivreMissedFeeds(params?: { pageSize?: number; maxPages?: number }) {
  const applicationId = String(process.env.MERCADOLIVRE_CLIENT_ID ?? "").trim();
  if (!applicationId) throw new Error("MERCADOLIVRE_CLIENT_ID ausente para consultar notificações perdidas.");

  const { data: accounts, error } = await supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, ml_user_id, access_token, refresh_token, expires_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;

  const knownUserIds = new Set((accounts ?? []).map((account) => Number(account.ml_user_id)).filter(Number.isFinite));
  const pageSize = Math.min(Math.max(params?.pageSize ?? 50, 1), 100);
  const maxPages = Math.min(Math.max(params?.maxPages ?? 20, 1), 100);
  const results: Array<{ accountId: number; notificationId?: number; duplicate?: boolean; skipped?: string; error?: string }> = [];

  for (const storedAccount of (accounts ?? []) as Account[]) {
    try {
      const accessToken = await ensureValidAccessToken(storedAccount);
      let offset = 0;

      for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
        const params = new URLSearchParams({ app_id: applicationId, offset: String(offset), limit: String(pageSize) });
        const response = await mercadoLivreApiGet<{ messages?: unknown[] }>(accessToken, `/missed_feeds?${params.toString()}`);
        const messages = Array.isArray(response.messages) ? response.messages : [];

        for (const rawMessage of messages) {
          const payload = normalizeMissedFeedPayload(rawMessage);
          const mlUserId = toNullableNumber(payload?.user_id);
          if (!payload || !mlUserId || !knownUserIds.has(mlUserId)) {
            results.push({ accountId: storedAccount.id, skipped: "Notificação perdida sem conta vinculada neste ERP." });
            continue;
          }

          const queued = await receiveMercadoLivreNotification(payload);
          results.push({
            accountId: storedAccount.id,
            notificationId: Number(queued.notificationId),
            duplicate: queued.duplicate,
          });
        }

        if (messages.length < pageSize) break;
        offset += messages.length;
      }

      // O feed é da aplicação; após uma consulta bem-sucedida, outra conta retornaria os mesmos eventos.
      break;
    } catch (feedError: any) {
      results.push({ accountId: storedAccount.id, error: feedError?.message || "Falha ao consultar notificações perdidas." });
    }
  }

  return results;
}

export async function retryMercadoLivreNotifications(limit = 50) {
  await requeueSupportedIgnoredNotifications();
  await ignoreOrphanedNotifications();
  const { data, error } = await supabaseAdmin.rpc("fn_reservar_notificacoes_mercadolivre", {
    p_limit: Math.min(Math.max(limit, 1), 100),
  });

  if (error) throw error;

  const results = [];
  for (const notification of data ?? []) {
    const notificationId = Number(notification.notification_id);
    try {
      await processNotification(notificationId, Number(notification.processing_attempts ?? 1));
      results.push({ id: notificationId, ok: true });
    } catch (error: any) {
      results.push({ id: notificationId, ok: false, error: error?.message || "Falha ao reprocessar notificação." });
    }
  }
  return results;
}

async function requeueSupportedIgnoredNotifications() {
  const { error } = await supabaseAdmin
    .from("mercadolivre_notification")
    .update({
      status: "RECEBIDA",
      error: null,
      next_retry_at: null,
      locked_at: null,
      processed_at: null,
    })
    .eq("status", "IGNORADA")
    .in("topic", ["user-products-families", "stock-locations"]);
  if (error) throw error;
}

async function ignoreOrphanedNotifications() {
  const [{ data: accounts, error: accountsError }, { data: pending, error: pendingError }] = await Promise.all([
    supabaseAdmin.from("mercadolivre_account").select("ml_user_id"),
    supabaseAdmin
      .from("mercadolivre_notification")
      .select("id, ml_user_id")
      .in("status", ["RECEBIDA", "PROCESSANDO", "ERRO"])
      .order("created_at", { ascending: true })
      .limit(1000),
  ]);
  if (accountsError) throw accountsError;
  if (pendingError) throw pendingError;

  const activeUserIds = new Set((accounts ?? []).map((account) => Number(account.ml_user_id)).filter(Number.isFinite));
  const orphanedIds = (pending ?? [])
    .filter((notification) => !activeUserIds.has(Number(notification.ml_user_id)))
    .map((notification) => Number(notification.id))
    .filter(Number.isFinite);
  if (!orphanedIds.length) return;

  const { error } = await supabaseAdmin
    .from("mercadolivre_notification")
    .update({
      account_id: null,
      status: "IGNORADA",
      error: "Evento encerrado porque a conta vendedora não está mais vinculada.",
      next_retry_at: null,
      locked_at: null,
      processed_at: new Date().toISOString(),
    })
    .in("id", orphanedIds);
  if (error) throw error;
}

async function processNotification(notificationId: number, attempts: number) {
  const { data: notification, error } = await supabaseAdmin
    .from("mercadolivre_notification")
    .select("id, account_id, ml_user_id, topic, resource, raw_payload, status")
    .eq("id", notificationId)
    .single();

  if (error) throw error;
  if (String(notification.status).toUpperCase() !== "PROCESSANDO") return;

  let resolvedAccountId: number | null = notification.account_id ? Number(notification.account_id) : null;
  try {
    const account = await getNotificationAccount(notification.account_id, notification.ml_user_id);
    if (!account) throw new Error("Conta Mercado Livre não encontrada para a notificação.");
    resolvedAccountId = account.id;
    const accessToken = await ensureValidAccessToken(account);
    const topic = String(notification.topic ?? "").toLowerCase();
    const resource = String(notification.resource ?? "");

    let finalStatus = "PROCESSADA";
    let finalError: string | null = null;
    let notificationDetails: Record<string, unknown> | null = null;
    let userNotification: ReturnType<typeof mercadoLivreSystemNotification> = null;

    if (topic === "orders_v2" || topic === "orders") {
      notificationDetails = await processOrder(account, accessToken, resource);
    } else if (topic === "shipments") {
      notificationDetails = await processShipment(account, accessToken, resource);
    } else if (topic === "items" || topic === "items_prices") {
      notificationDetails = await processItem(account, accessToken, resource, notificationId, topic);
    } else if (topic === "user-products-families") {
      notificationDetails = await processUserProductFamily(account, accessToken, resource);
    } else if (topic === "stock-locations") {
      notificationDetails = await processUserProductStock(account, accessToken, resource);
    } else if (topic.includes("claim") || topic.includes("reclama")) {
      notificationDetails = await processClaim(account, accessToken, resource);
    } else if (topic === "questions") {
      notificationDetails = await processQuestion(accessToken, resource);
    } else if (topic === "messages" || topic === "messaging") {
      notificationDetails = await processMessage(account, accessToken, resource);
    } else if (topic === "payments") {
      // O estado financeiro já é reconciliado por orders_v2 e pelo cron. Apps
      // Mercado Livre e Mercado Pago devem permanecer separados desde 30/08/2026.
      finalStatus = "IGNORADA";
      finalError = "Pagamento acompanhado pelo pedido orders_v2; tópico payments não requer processamento separado.";
    } else if (topic.includes("feedback")) {
      notificationDetails = await processFeedback(account, accessToken, resource);
    } else {
      finalStatus = "IGNORADA";
      finalError = `Tópico sem processador configurado: ${topic || "não informado"}.`;
    }

    if (finalStatus === "PROCESSADA") {
      userNotification = mercadoLivreSystemNotification({ notificationId, topic, resource, details: notificationDetails });
      if (userNotification) {
        try {
          await notifySalesUsers(userNotification);
          await processTelegramMarketplaceNotifications({ sourceEventId: userNotification.sourceEventId });
        } catch (notificationError) {
          // A central de avisos é complementar: uma falha nela não pode desfazer
          // a importação do pedido, envio ou anúncio já processado com sucesso.
          console.error("Falha ao criar notificação interna do Mercado Livre", notificationError);
        }
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from("mercadolivre_notification")
      .update({
        account_id: resolvedAccountId,
        status: finalStatus,
        error: finalError,
        processed_at: new Date().toISOString(),
        next_retry_at: null,
        locked_at: null,
        raw_payload: userNotification
          ? { ...(notification.raw_payload ?? {}), _erp_notification: userNotification }
          : notification.raw_payload,
      })
      .eq("id", notificationId);
    if (updateError) throw updateError;
  } catch (error: any) {
    const retryMinutes = Math.min(2 ** Math.min(attempts, 6), 60);
    await supabaseAdmin
      .from("mercadolivre_notification")
      .update({
        account_id: resolvedAccountId,
        status: "ERRO",
        error: String(error?.message || "Falha ao processar notificação.").slice(0, 2000),
        next_retry_at: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
        locked_at: null,
      })
      .eq("id", notificationId);
    throw error;
  }
}

async function processQuestion(accessToken: string, resource: string) {
  if (!resource) throw new Error("Notificação de pergunta sem recurso.");
  const question = await mercadoLivreApiGet<any>(accessToken, normalizeResource(resource));
  const itemId = String(question?.item_id ?? "").trim();
  const item = itemId
    ? await mercadoLivreApiGet<any>(accessToken, `/items/${encodeURIComponent(itemId)}`).catch(() => null)
    : null;
  return { question, item };
}

async function processMessage(account: Account, accessToken: string, resource: string) {
  if (!resource) throw new Error("Notificação de mensagem sem recurso.");
  const separator = resource.includes("?") ? "&" : "?";
  const path = resource.includes("tag=") ? resource : `${resource}${separator}tag=post_sale`;
  const message = await mercadoLivreApiGet<any>(accessToken, normalizeResource(path));
  const messages = Array.isArray(message?.messages) ? message.messages : [];
  const latestMessage = messages[messages.length - 1] ?? message?.message ?? message;
  const packId = latestMessage?.pack_id ?? message?.pack_id ?? latestMessage?.message_resources?.[0]?.id;
  const orderId = latestMessage?.order_id ?? message?.order_id;
  const { data: storedOrders, error } = await supabaseAdmin
    .from("mercadolivre_order")
    .select("id, ml_order_id, buyer_id, status, total_amount, currency_id, raw_order")
    .eq("empresa_id", account.empresa_id)
    .eq("account_id", account.id)
    .order("date_created", { ascending: false })
    .limit(30);
  if (error) throw error;
  const order = (storedOrders ?? []).find((candidate: any) =>
    (orderId && String(candidate.ml_order_id) === String(orderId))
    || (packId && String(candidate.raw_order?.pack_id ?? candidate.raw_order?.pack?.id ?? "") === String(packId)),
  ) ?? null;
  return { message, order };
}

async function processFeedback(account: Account, accessToken: string, resource: string) {
  const orderId = extractOrderId(resource);
  if (!orderId) throw new Error("Notificação de feedback sem order_id.");
  const order = await getMercadoLivreOrder(accessToken, orderId);
  await importMercadoLivreOrder({ ...account, access_token: accessToken }, order);
  return { order };
}

async function processOrder(account: Account, accessToken: string, resource: string) {
  const orderId = extractResourceId(resource);
  if (!orderId) throw new Error("Notificação de pedido sem order_id.");
  const order = await getMercadoLivreOrder(accessToken, orderId);
  await importMercadoLivreOrder({ ...account, access_token: accessToken }, order);
  return { order };
}

async function processShipment(account: Account, accessToken: string, resource: string) {
  const shipmentId = extractResourceId(resource);
  if (!shipmentId) throw new Error("Notificação de envio sem shipment_id.");
  const shipment = await mercadoLivreApiGet<any>(accessToken, `/shipments/${encodeURIComponent(shipmentId)}`);
  const orderId = Number(shipment?.order_id ?? shipment?.order?.id ?? 0);

  if (Number.isFinite(orderId) && orderId > 0) {
    const order = await getMercadoLivreOrder(accessToken, orderId);
    await importMercadoLivreOrder({ ...account, access_token: accessToken }, order);
    return { shipment, order };
  }

  const { data: storedOrders, error } = await supabaseAdmin
    .from("mercadolivre_order")
    .select("ml_order_id, venda_id")
    .eq("empresa_id", account.empresa_id)
    .eq("account_id", account.id)
    .eq("ml_shipment_id", Number(shipmentId));
  if (error) throw error;
  if (!storedOrders?.length) throw new Error(`Envio ${shipmentId} sem pedido vinculado no ERP.`);

  // Um pack pode conter mais de uma order usando o mesmo shipment. Atualizamos
  // todas as vendas vinculadas para não deixar parte do carrinho desatualizada.
  let relatedOrder: any = null;
  for (const storedOrder of storedOrders) {
    const mlOrderId = Number(storedOrder.ml_order_id);
    if (Number.isFinite(mlOrderId) && mlOrderId > 0) {
      const order = await getMercadoLivreOrder(accessToken, mlOrderId);
      await importMercadoLivreOrder({ ...account, access_token: accessToken }, order);
      relatedOrder ??= order;
    } else if (storedOrder.venda_id) {
      await syncMercadoLivreShipmentForVenda(Number(storedOrder.venda_id));
    }
  }
  return { shipment, order: relatedOrder };
}

async function processItem(
  account: Account,
  accessToken: string,
  resource: string,
  notificationId: number,
  topic: string,
) {
  const itemId = extractItemId(resource);
  if (!itemId) throw new Error("Notificação de anúncio sem item_id.");
  const item = await mercadoLivreApiGet<any>(accessToken, `/items/${encodeURIComponent(itemId)}`);
  const userProduct = item?.user_product_id
    ? await mercadoLivreApiGet<any>(accessToken, `/user-products/${encodeURIComponent(String(item.user_product_id))}`).catch(() => null)
    : null;
  const { data: links, error: linksError } = await supabaseAdmin
    .from("mercadolivre_product_link")
    .select("id, produto_id, title, available_quantity, raw_item, produto:produto(precovenda, titulo, tituloMarketplace)")
    .eq("empresa_id", account.empresa_id)
    .eq("ml_item_id", itemId);
  if (linksError) throw linksError;

  const priceState = await getMercadoLivrePriceState(accessToken, itemId, item);
  const mercadoLivrePrice = priceState.standardPrice;
  if (mercadoLivrePrice != null) {
    for (const link of links ?? []) {
      const produto = Array.isArray((link as any).produto) ? (link as any).produto[0] : (link as any).produto;
      const erpPrice = Number(produto?.precovenda);
      if (Number.isFinite(erpPrice) && Math.abs(erpPrice - mercadoLivrePrice) < 0.01) continue;

      const previousMlPrice = Number((link as any).raw_item?._erp_price_state?.standardPrice ?? (link as any).raw_item?.price);
      await applyMercadoLivrePriceToErp({
        productLinkId: Number(link.id),
        price: mercadoLivrePrice,
        source: topic.toUpperCase(),
        notificationId,
        mlPriceBefore: Number.isFinite(previousMlPrice) ? previousMlPrice : null,
      });
    }
  }

  const { error } = await supabaseAdmin
    .from("mercadolivre_product_link")
    .update({
      status: item?.status ?? null,
      title: item?.title ?? null,
      permalink: item?.permalink ?? null,
      user_product_id: item?.user_product_id ?? null,
      family_id: userProduct?.family_id ?? item?.family_id ?? null,
      family_name: item?.family_name ?? userProduct?.family_name ?? null,
      domain_id: item?.domain_id ?? userProduct?.domain_id ?? null,
      catalog_product_id: item?.catalog_product_id ?? userProduct?.catalog_product_id ?? null,
      user_product_enabled: Boolean(item?.family_name || item?.user_product_id),
      item_tags: Array.isArray(item?.tags) ? item.tags : [],
      raw_item: { ...(item ?? {}), ...(userProduct ? { _erp_user_product: userProduct } : {}), _erp_price_state: priceState },
      updated_at: new Date().toISOString(),
    })
    .eq("empresa_id", account.empresa_id)
    .eq("ml_item_id", itemId);
  if (error) throw error;
  return { item, userProduct, stockChange: resolveStockChange(links ?? [], item?.available_quantity) };
}

async function processUserProductFamily(account: Account, accessToken: string, resource: string) {
  if (!resource) throw new Error("Notificação de família de produto sem recurso.");
  const family = await mercadoLivreApiGet<any>(accessToken, normalizeResource(resource));
  const familyId = String(family?.id ?? extractResourceId(resource) ?? "").trim();
  if (!familyId) throw new Error("Notificação de família de produto sem family_id.");

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const familyName = family?.name ?? family?.family_name;
  if (familyName) updates.family_name = String(familyName);
  if (family?.domain_id) updates.domain_id = String(family.domain_id);
  if (family?.catalog_product_id) updates.catalog_product_id = String(family.catalog_product_id);

  const { error } = await supabaseAdmin
    .from("mercadolivre_product_link")
    .update(updates)
    .eq("empresa_id", account.empresa_id)
    .eq("family_id", familyId);
  if (error) throw error;
  return { userProduct: family };
}

async function processUserProductStock(account: Account, accessToken: string, resource: string) {
  if (!resource) throw new Error("Notificação de estoque do anúncio sem recurso.");
  const stock = await mercadoLivreApiGet<any>(accessToken, normalizeResource(resource));
  const userProductId = resource.match(/\/user-products\/([^/?]+)\/stock/i)?.[1];
  if (!userProductId) throw new Error("Notificação de estoque sem user_product_id.");

  const availableQuantity = getUserProductAvailableQuantity(stock);
  const { data: links, error: linksError } = await supabaseAdmin
    .from("mercadolivre_product_link")
    .select("id, ml_item_id, title, available_quantity, raw_item, produto:produto(titulo, tituloMarketplace)")
    .eq("empresa_id", account.empresa_id)
    .eq("user_product_id", decodeURIComponent(userProductId));
  if (linksError) throw linksError;
  const stockChange = resolveStockChange(links ?? [], availableQuantity, true);
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (availableQuantity != null) updates.available_quantity = availableQuantity;

  const { error } = await supabaseAdmin
    .from("mercadolivre_product_link")
    .update(updates)
    .eq("empresa_id", account.empresa_id)
    .eq("user_product_id", decodeURIComponent(userProductId));
  if (error) throw error;
  return { stock, stockChange };
}

function resolveStockChange(links: any[], currentQuantityValue: unknown, includeUnchanged = false) {
  const currentQuantity = finiteStockQuantity(currentQuantityValue);
  if (currentQuantity == null) return null;

  const link = links[0] ?? null;
  const synchronized = link?.raw_item?._erp_stock_sync;
  const synchronizedAt = Date.parse(String(synchronized?.synchronizedAt ?? ""));
  const recentSynchronization = Number.isFinite(synchronizedAt) && Date.now() - synchronizedAt <= 60 * 60_000;
  const synchronizedCurrent = finiteStockQuantity(synchronized?.currentQuantity);
  const storedPrevious = finiteStockQuantity(link?.available_quantity);
  const previousQuantity =
    recentSynchronization && synchronizedCurrent === currentQuantity
      ? finiteStockQuantity(synchronized?.previousQuantity)
      : storedPrevious;
  const product = Array.isArray(link?.produto) ? link.produto[0] : link?.produto;
  if (!includeUnchanged && (previousQuantity == null || previousQuantity === currentQuantity)) return null;

  return {
    previousQuantity,
    currentQuantity,
    delta: previousQuantity == null ? null : currentQuantity - previousQuantity,
    itemId: link?.ml_item_id ?? link?.raw_item?.id ?? null,
    itemTitle: link?.title ?? product?.tituloMarketplace ?? product?.titulo ?? null,
  };
}

function finiteStockQuantity(value: unknown) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? Math.trunc(quantity) : null;
}

function getUserProductAvailableQuantity(stock: any) {
  const direct = Number(stock?.available_quantity ?? stock?.quantity);
  if (Number.isFinite(direct) && direct >= 0) return Math.trunc(direct);

  const locations = Array.isArray(stock?.locations) ? stock.locations : [];
  if (!locations.length) return null;
  return locations.reduce((total: number, location: any) => {
    const quantity = Number(location?.available_quantity ?? location?.quantity ?? 0);
    return total + (Number.isFinite(quantity) && quantity > 0 ? Math.trunc(quantity) : 0);
  }, 0);
}

async function processClaim(account: Account, accessToken: string, resource: string) {
  const claimId = extractResourceId(resource);
  if (!claimId) throw new Error("Notificação de reclamação sem claim_id.");
  const claim = await mercadoLivreApiGet<any>(accessToken, `/post-purchase/v1/claims/${encodeURIComponent(claimId)}`);
  const order = await findRelatedOrder(account.empresa_id, account.id, claim);
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
  return { claim, order };
}

async function insertOrGetNotification(payload: NotificationPayload, dedupeKey: string, accountId: number) {
  const row = {
    account_id: accountId,
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
  if (!error) return { ...data, duplicate: false };
  if (error.code !== "23505") throw error;

  const existing = await supabaseAdmin.from("mercadolivre_notification").select("id, status").eq("dedupe_key", dedupeKey).single();
  if (existing.error) throw existing.error;
  return { ...existing.data, duplicate: true };
}

function buildDedupeKey(payload: NotificationPayload) {
  const eventMarker = payload.sent || payload.received || JSON.stringify(payload);
  const source = [payload.topic, payload.resource, payload.user_id, payload.application_id, eventMarker].map((value) => String(value ?? "")).join("|");
  return createHash("sha256").update(source).digest("hex");
}

function normalizeMissedFeedPayload(value: unknown): NotificationPayload | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  let embedded: Record<string, unknown> = {};

  if (typeof message.data === "string") {
    try {
      const parsed = JSON.parse(message.data);
      if (parsed && typeof parsed === "object") embedded = parsed as Record<string, unknown>;
    } catch {
      embedded = {};
    }
  } else if (message.data && typeof message.data === "object") {
    embedded = message.data as Record<string, unknown>;
  }

  return { ...message, ...embedded } as NotificationPayload;
}

function extractResourceId(resource: string) {
  return resource.split("?")[0].split("/").filter(Boolean).pop() || null;
}

function extractItemId(resource: string) {
  const match = resource.match(/\/items\/(MLB\d+)/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function extractOrderId(resource: string) {
  const match = resource.match(/\/orders\/(\d+)/i);
  return match ? Number(match[1]) : null;
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

async function getNotificationAccount(accountId: number | null, mlUserId: number | null) {
  let query = supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, ml_user_id, access_token, refresh_token, expires_at")
    .limit(1);
  if (accountId) {
    query = query.eq("id", accountId);
    if (mlUserId) query = query.eq("ml_user_id", mlUserId);
  }
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
      raw_token: mercadoLivreTokenMetadata(token),
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);
  if (error) throw error;
  return token.access_token;
}

async function findRelatedOrder(empresaId: number, accountId: number, claim: any) {
  const raw = JSON.stringify(claim ?? {});
  const resourceId = Number(claim?.resource_id ?? claim?.resource?.id ?? 0);
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_order")
    .select("id, ml_order_id, ml_shipment_id, raw_order")
    .eq("empresa_id", empresaId)
    .eq("account_id", accountId)
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
