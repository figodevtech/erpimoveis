import { ensureMercadoLivreToken } from "@/lib/integrations/mercadolivre-token";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getMercadoLivreOrder,
  mercadoLivreApiGet,
  
  
  searchMercadoLivreOrders,
  
  type MercadoLivreOrder,
  type MercadoLivreOrderItem,
} from "@/lib/integrations/mercadolivre";
import { normalizeShipment, reconcileShipmentState, type MercadoLivreShipment } from "@/lib/integrations/mercadolivre-shipping";
import { shouldWaitForMercadoLivreReturnInspection } from "@/lib/integrations/mercadolivre-return-policy";

type MercadoLivreAccount = {
  id: number;
  empresa_id: number;
  ml_user_id: number;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};

type ImportResult = {
  mlOrderId: number;
  vendaId: number | null;
  created: boolean;
  skipped?: string;
  error?: string;
};

export async function syncMercadoLivreOrders(params?: { accountId?: number; empresaId?: number; days?: number; limit?: number }) {
  const accounts = await getAccounts(params?.accountId, params?.empresaId);
  const results: ImportResult[] = [];

  for (const account of accounts) {
    const accessToken = await ensureValidAccessToken(account);
    const dateFrom = new Date(Date.now() - (params?.days ?? 15) * 24 * 60 * 60 * 1000).toISOString();
    const dateTo = new Date().toISOString();
    const pageSize = Math.min(Math.max(params?.limit ?? 50, 1), 50);
    const searchedOrderIds = await searchAllUpdatedOrderIds(accessToken, account.ml_user_id, dateFrom, dateTo, pageSize);
    const storedOrderIds = await getStoredOrderIdsForReconciliation(account.empresa_id, account.id, 50);
    const orderIds = Array.from(new Set([...searchedOrderIds, ...storedOrderIds]));

    for (let index = 0; index < orderIds.length; index += 5) {
      const batch = orderIds.slice(index, index + 5);
      const batchResults = await Promise.all(
        batch.map(async (rawOrderId): Promise<ImportResult | null> => {
          const orderId = Number(rawOrderId);
          if (!Number.isFinite(orderId)) return null;

          try {
            const order = await getMercadoLivreOrder(accessToken, orderId);
            return await importMercadoLivreOrder(account, order);
          } catch (e: any) {
            return {
              mlOrderId: orderId,
              vendaId: null,
              created: false,
              error: e?.message || "Falha ao importar pedido.",
            } satisfies ImportResult;
          }
        }),
      );
      for (const result of batchResults) {
        if (result) results.push(result);
      }
    }
  }

  return results;
}

async function searchAllUpdatedOrderIds(accessToken: string, sellerId: number, dateFrom: string, dateTo: string, pageSize: number) {
  const orderIds = new Set<number>();
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const search = await searchMercadoLivreOrders(accessToken, {
      sellerId,
      offset,
      limit: pageSize,
      orderDateLastUpdatedFrom: dateFrom,
      orderDateLastUpdatedTo: dateTo,
    });
    const page = Array.isArray(search.results) ? search.results : [];
    total = Math.max(Number(search.paging?.total ?? page.length), 0);

    for (const summary of page) {
      const orderId = Number(summary.id);
      if (Number.isFinite(orderId)) orderIds.add(orderId);
    }

    if (page.length === 0) break;
    offset += page.length;
    if (page.length < pageSize) break;
  }

  return Array.from(orderIds);
}

async function getStoredOrderIdsForReconciliation(empresaId: number, accountId: number, limit: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_order")
    .select("ml_order_id")
    .eq("empresa_id", empresaId)
    .eq("account_id", accountId)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) throw error;

  return (data ?? [])
    .map((order) => Number(order.ml_order_id))
    .filter((orderId) => Number.isFinite(orderId) && orderId > 0);
}

export async function importMercadoLivreOrder(account: MercadoLivreAccount, order: MercadoLivreOrder) {
  const accessToken = await ensureValidAccessToken(account);
  await hydrateSaleFeedback(accessToken, order);
  const mlOrderId = Number(order.id);
  if (!Number.isFinite(mlOrderId)) {
    return { mlOrderId: 0, vendaId: null, created: false, skipped: "Pedido sem id valido." };
  }

  const shipment = await fetchOrderShipment(accessToken, order);
  const existing = await findExistingOrder(mlOrderId, account.empresa_id);
  if (Object.keys(getSaleFeedback(order)).length === 0 && existing?.feedback_sale && Object.keys(existing.feedback_sale).length > 0) {
    order.feedback_detail = existing.feedback_sale;
  }
  const shouldDecrementStock = mapOrderToVendaStatus(order) === "FINALIZADA";
  if (existing?.venda_id) {
    await upsertOrderRecord(account, order, existing.venda_id, shipment, existing);
    await updateVendaOrderStatus(existing.venda_id, order, shipment);
    if (shouldDecrementStock) {
      await applyMarketplaceStockDecrement(existing.venda_id, account.empresa_id, order.order_items ?? []);
    }
    return { mlOrderId, vendaId: existing.venda_id, created: false, skipped: "Venda ja importada." };
  }

  await upsertOrderRecord(account, order, null, shipment);

  const { data: reserved, error: reserveError } = await supabaseAdmin.rpc("fn_reservar_importacao_mercadolivre", {
    p_ml_order_id: mlOrderId,
    p_empresa_id: account.empresa_id,
  });
  if (reserveError) throw reserveError;
  if (!reserved) {
    const current = await findExistingOrder(mlOrderId, account.empresa_id);
    return {
      mlOrderId,
      vendaId: current?.venda_id ?? null,
      created: false,
      skipped: current?.venda_id ? "Venda já importada." : "Pedido já está sendo importado por outro processo.",
    };
  }

  try {
    const clienteId = await getOrCreateMarketplaceCustomer(order, shipment);
    const vendaPayload = buildVendaPayload(clienteId, order);
    const orderItems = Array.isArray(order.order_items) ? order.order_items : [];
    const vendaItems = [];

    for (const item of orderItems) {
      const resolvedProduct = await resolveProdutoId(account.empresa_id, item);
      const quantity = toPositiveInt(item.quantity) ?? 1;
      const unitPrice = Number(item.unit_price ?? item.full_unit_price ?? 0);
      const itemTotal = Number((unitPrice * quantity).toFixed(2));

      vendaItems.push({
        produtoId: resolvedProduct.produtoId,
        quantidade: quantity,
        subTotal: itemTotal,
        valorTotal: itemTotal,
        baixarEstoque: resolvedProduct.baixarEstoque && shouldDecrementStock,
      });
    }

    const { data: vendaIdResult, error: vendaError } = await supabaseAdmin.rpc("fn_criar_venda_mercadolivre_reservada", {
      p_ml_order_id: mlOrderId,
      p_empresa_id: account.empresa_id,
      p_venda: {
        ...vendaPayload,
        clienteId,
        statusEntrega: vendaPayload.status_entrega,
        valorTotal: vendaPayload.valortotal,
        subTotal: vendaPayload.sub_total,
        descontoTipo: vendaPayload.desconto_tipo,
        descontoValor: vendaPayload.desconto_valor,
        formaPagamento: vendaPayload.forma_pagamento,
        dataVenda: vendaPayload.datavenda,
        itens: vendaItems,
      },
    });

    if (vendaError) throw vendaError;

    const vendaId = Number(vendaIdResult);
    await upsertOrderRecord(account, order, vendaId, shipment);
    return { mlOrderId, vendaId, created: true };
  } catch (error: any) {
    await setOrderImportState(mlOrderId, account.empresa_id, "ERRO", error?.message || "Falha ao importar pedido.");
    throw error;
  }
}

async function setOrderImportState(mlOrderId: number, empresaId: number, status: string, error: string | null) {
  const { error: updateError } = await supabaseAdmin
    .from("mercadolivre_order")
    .update({ import_status: status, import_locked_at: null, import_error: error, updated_at: new Date().toISOString() })
    .eq("ml_order_id", mlOrderId)
    .eq("empresa_id", empresaId);
  if (updateError) throw updateError;
}

async function getAccounts(accountId?: number, empresaId?: number) {
  let query = supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, ml_user_id, access_token, refresh_token, expires_at")
    .order("updated_at", { ascending: false });

  if (accountId) query = query.eq("id", accountId);
  if (empresaId) query = query.eq("empresa_id", empresaId);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as MercadoLivreAccount[];
}

async function ensureValidAccessToken(account: MercadoLivreAccount) {
  return ensureMercadoLivreToken(account);
}

async function findExistingOrder(mlOrderId: number, empresaId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_order")
    .select(
      "id, venda_id, shipment_status, shipment_substatus, shipping_mode, logistic_type, tracking_number, tracking_method, raw_shipment, feedback_sale",
    )
    .eq("ml_order_id", mlOrderId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error) throw error;
  return data as
    | {
        id: number;
        venda_id: number | null;
        shipment_status?: string | null;
        shipment_substatus?: string | null;
        shipping_mode?: string | null;
        logistic_type?: string | null;
        tracking_number?: string | null;
        tracking_method?: string | null;
        raw_shipment?: any;
        feedback_sale?: any;
      }
    | null;
}

async function upsertOrderRecord(
  account: MercadoLivreAccount,
  order: MercadoLivreOrder,
  vendaId: number | null,
  shipment?: MercadoLivreShipment | null,
  currentOrder?: Awaited<ReturnType<typeof findExistingOrder>>,
) {
  const normalizedShipment = shipment ? reconcileShipmentState(normalizeShipment(shipment), currentOrder) : null;
  const nowIso = new Date().toISOString();
  const paymentSummary = getOrderPaymentSummary(order);
  const tags = getOrderTags(order);
  const cancelDetail = order.cancel_detail && typeof order.cancel_detail === "object" ? order.cancel_detail : null;
  const feedbackSale = getSaleFeedback(order);
  const { error } = await supabaseAdmin.from("mercadolivre_order").upsert(
    {
      empresa_id: account.empresa_id,
      account_id: account.id,
      venda_id: vendaId,
      ml_order_id: Number(order.id),
      // Um pack agrupa várias orders do mesmo carrinho e é a chave da conversa
      // do comprador; guardá-lo evita procurar o pedido varrendo JSON.
      ml_pack_id: toNullableNumber((order as any).pack_id ?? (order as any).pack?.id),
      status: order.status ?? null,
      status_detail: typeof order.status_detail === "string" ? order.status_detail : null,
      payment_status: paymentSummary.status,
      payment_status_detail: paymentSummary.statusDetail,
      order_tags: tags,
      date_closed: typeof order.date_closed === "string" ? order.date_closed : null,
      cancel_group: cancelDetail?.group ?? null,
      cancel_code: cancelDetail?.code ?? null,
      cancel_description: cancelDetail?.description ?? null,
      cancel_requested_by: cancelDetail?.requested_by ?? null,
      cancel_date: cancelDetail?.date ?? null,
      feedback_sale: feedbackSale,
      date_created: order.date_created ?? null,
      total_amount: Number(order.total_amount ?? order.paid_amount ?? 0),
      currency_id: order.currency_id ?? null,
      buyer_id: order.buyer?.id ?? null,
      ml_shipment_id: normalizedShipment?.id || toNullableNumber(order.shipping?.id),
      shipment_status: normalizedShipment?.status ?? null,
      shipment_substatus: normalizedShipment?.substatus ?? null,
      shipping_mode: normalizedShipment?.mode ?? null,
      logistic_type: normalizedShipment?.logisticType ?? null,
      tracking_number: normalizedShipment?.trackingNumber ?? null,
      tracking_method: normalizedShipment?.trackingMethod ?? null,
      raw_order: order,
      raw_payments: paymentSummary.payments,
      raw_shipment:
        shipment && typeof shipment === "object"
          ? {
              ...shipment,
              ...(currentOrder?.raw_shipment?.custom ? { custom: currentOrder.raw_shipment.custom } : {}),
            }
          : currentOrder?.raw_shipment ?? {},
      shipment_updated_at: shipment ? nowIso : null,
      last_synced_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "ml_order_id" },
  );

  if (error) throw error;

  if (vendaId && normalizedShipment) {
    await updateVendaShipment(vendaId, normalizedShipment);
  }
}

async function getOrCreateMarketplaceCustomer(order?: MercadoLivreOrder, shipment?: MercadoLivreShipment | null) {
  const buyerId = Number(order?.buyer?.id ?? 0);
  const buyerName = formatBuyerName(order);
  const document = buyerId > 0 ? `ML${buyerId}` : "ML0000000001";

  const { data: existingByDocument, error: existingByDocumentError } = await supabaseAdmin
    .from("cliente")
    .select("id")
    .eq("cpfcnpj", document)
    .maybeSingle();

  if (existingByDocumentError) throw existingByDocumentError;
  if (existingByDocument?.id) return Number(existingByDocument.id);

  if (!buyerId) {
    return getOrCreateGenericMarketplaceCustomer();
  }

  const receiverAddress = shipment?.receiver_address && typeof shipment.receiver_address === "object" ? (shipment.receiver_address as any) : null;
  const baseCustomer = {
    tipopessoa: "FISICA",
    cpfcnpj: document,
    nomerazaosocial: buyerName,
    email: `ml-${buyerId}@marketplace.local`,
    telefone: `ML${buyerId}`,
    endereco: receiverAddress?.address_line || receiverAddress?.street_name || null,
    endereconumero: receiverAddress?.street_number ? String(receiverAddress.street_number) : null,
    bairro: receiverAddress?.neighborhood?.name || receiverAddress?.neighborhood || null,
    cidade: receiverAddress?.city?.name || receiverAddress?.city || "Nao informado",
    estado: receiverAddress?.state?.id || receiverAddress?.state?.name || "NI",
    cep: receiverAddress?.zip_code || null,
    status: "ATIVO",
  };

  const { data, error } = await supabaseAdmin
    .from("cliente")
    .insert(baseCustomer)
    .select("id")
    .single();

  if (!error) return Number(data.id);

  if (isUniqueViolation(error)) {
    const { data: concurrentCustomer, error: concurrentCustomerError } = await supabaseAdmin
      .from("cliente")
      .select("id")
      .eq("cpfcnpj", document)
      .maybeSingle();
    if (concurrentCustomerError) throw concurrentCustomerError;
    if (concurrentCustomer?.id) return Number(concurrentCustomer.id);

    const { data: retryData, error: retryError } = await supabaseAdmin
      .from("cliente")
      .insert({
        ...baseCustomer,
        nomerazaosocial: `${buyerName} (Mercado Livre #${buyerId})`,
      })
      .select("id")
      .single();

    if (!retryError) return Number(retryData.id);
    throw retryError;
  }

  throw error;
}

async function getOrCreateGenericMarketplaceCustomer() {
  const customerName = "Consumidor Mercado Livre";
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("cliente")
    .select("id")
    .eq("nomerazaosocial", customerName)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing?.id) return Number(existing.id);

  const { data, error } = await supabaseAdmin
    .from("cliente")
    .insert({
      tipopessoa: "FISICA",
      cpfcnpj: "ML0000000001",
      nomerazaosocial: customerName,
      email: "mercadolivre@marketplace.local",
      telefone: "ML0000000001",
      cidade: "Nao informado",
      estado: "NI",
      status: "ATIVO",
    })
    .select("id")
    .single();

  if (error && isUniqueViolation(error)) {
    const { data: concurrentCustomer, error: concurrentCustomerError } = await supabaseAdmin
      .from("cliente")
      .select("id")
      .eq("cpfcnpj", "ML0000000001")
      .maybeSingle();
    if (concurrentCustomerError) throw concurrentCustomerError;
    if (concurrentCustomer?.id) return Number(concurrentCustomer.id);
  }
  if (error) throw error;
  return Number(data.id);
}

function formatBuyerName(order?: MercadoLivreOrder) {
  const buyer = order?.buyer;
  const fullName = [buyer?.first_name, buyer?.last_name].map((value) => String(value ?? "").trim()).filter(Boolean).join(" ");
  if (fullName) return fullName;
  if (buyer?.nickname) return String(buyer.nickname).trim();
  if (buyer?.id) return `Comprador Mercado Livre #${buyer.id}`;
  return "Consumidor Mercado Livre";
}

function isUniqueViolation(error: any) {
  return error?.code === "23505" || String(error?.message ?? "").toLowerCase().includes("duplicate key");
}

function buildVendaPayload(clienteId: number, order: MercadoLivreOrder) {
  const total = Number(order.total_amount ?? order.paid_amount ?? calculateItemsTotal(order.order_items ?? []));
  const status = mapOrderToVendaStatus(order);
  const externalId = Number(order.id);

  return {
    clienteid: clienteId,
    status,
    canal: "MERCADO_LIVRE",
    status_entrega: status === "FINALIZADA" ? "SEPARACAO" : null,
    valortotal: total,
    sub_total: total,
    desconto_tipo: null,
    desconto_valor: null,
    forma_pagamento: "MERCADO_LIVRE",
    datavenda: order.date_created ?? new Date().toISOString(),
    createdat: new Date().toISOString(),
    updatedat: new Date().toISOString(),
    observacoes: `Pedido Mercado Livre #${externalId}`,
  };
}

async function fetchOrderShipment(accessToken: string, order: MercadoLivreOrder) {
  const shipmentId = toNullableNumber(order.shipping?.id);
  if (!shipmentId) return null;

  try {
    const response = await fetch(`https://api.mercadolibre.com/shipments/${encodeURIComponent(String(shipmentId))}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "x-format-new": "true",
      },
      cache: "no-store",
    });

    if (!response.ok) return null;
    return (await response.json()) as MercadoLivreShipment;
  } catch {
    return null;
  }
}

async function updateVendaShipment(vendaId: number, shipment: ReturnType<typeof normalizeShipment>) {
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    transportadora_rastreio: "MERCADO_ENVIOS",
    codigo_rastreio: shipment.trackingNumber,
    status_rastreio: shipment.statusRastreio,
    ultimo_evento_rastreio: shipment.lastEventTitle,
    ultimo_evento_rastreio_em: shipment.lastUpdated,
    eventos_rastreio: shipment.events,
    rastreio_atualizado_em: nowIso,
    updatedat: nowIso,
  };

  if (shipment.statusEntrega) patch.status_entrega = shipment.statusEntrega;
  if (shipment.receiverAddress) patch.endereco_entrega_snapshot = shipment.receiverAddress;

  const { error } = await supabaseAdmin.from("venda").update(patch).eq("id", vendaId);
  if (error) throw error;
}

async function updateVendaOrderStatus(vendaId: number, order: MercadoLivreOrder, shipment?: MercadoLivreShipment | null) {
  const status = mapOrderToVendaStatus(order);
  if (status === "CANCELADA") {
    const atual = await supabaseAdmin.from("venda").select("status").eq("id", vendaId).maybeSingle();
    if (atual.error) throw atual.error;
    if (!["CANCELADA", "CANCELADO"].includes(String(atual.data?.status ?? "").toUpperCase())) {
      const cancellationReason = `Cancelado no Mercado Livre (pedido #${Number(order.id)}).`;
      const cancelamento = shouldWaitForMercadoLivreReturnInspection(order, shipment)
        ? await supabaseAdmin.rpc("cancelar_venda_marketplace_sem_repor_estoque", {
            p_venda_id: vendaId,
            p_motivo: `${cancellationReason} Estoque aguardando conferência da devolução.`,
          })
        : await supabaseAdmin.rpc("cancelar_venda", {
            p_venda_id: vendaId,
            p_motivo: cancellationReason,
            p_cancelada_by: null,
          });
      if (cancelamento.error) throw cancelamento.error;
    }
  }
  const patch: Record<string, unknown> = {
    status,
    updatedat: new Date().toISOString(),
  };

  if (status === "CANCELADA") {
    patch.status_entrega = null;
    patch.observacoes = `Pedido Mercado Livre #${Number(order.id)} cancelado no marketplace.`;
  }

  const { error } = await supabaseAdmin.from("venda").update(patch).eq("id", vendaId);
  if (error) throw error;
}

async function applyMarketplaceStockDecrement(vendaId: number, empresaId: number, orderItems: MercadoLivreOrderItem[]) {
  for (const item of orderItems) {
    const resolvedProduct = await resolveProdutoId(empresaId, item);
    if (!resolvedProduct.baixarEstoque) continue;

    const quantity = toPositiveInt(item.quantity) ?? 1;
    const { error } = await supabaseAdmin.rpc("fn_sincronizar_baixa_estoque_marketplace", {
      p_venda_id: vendaId,
      p_produto_id: resolvedProduct.produtoId,
      p_quantidade_alvo: quantity,
    });
    if (error) throw error;
  }
}

async function resolveProdutoId(empresaId: number, item: MercadoLivreOrderItem) {
  const mlItemId = item.item?.id ? String(item.item.id) : null;
  const mlVariationId = item.item?.variation_id ?? null;

  if (mlItemId) {
    let query = supabaseAdmin
      .from("mercadolivre_product_link")
      .select("produto_id")
      .eq("empresa_id", empresaId)
      .eq("ml_item_id", mlItemId);

    if (mlVariationId) query = query.eq("ml_variation_id", mlVariationId);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (data?.produto_id) return { produtoId: Number(data.produto_id), baixarEstoque: true };
  }

  return { produtoId: await getOrCreatePlaceholderProduct(), baixarEstoque: false };
}

async function getOrCreatePlaceholderProduct() {
  const title = "Produto Mercado Livre sem vinculo";
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("produto")
    .select("id")
    .eq("titulo", title)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing?.id) return Number(existing.id);

  const { data, error } = await supabaseAdmin
    .from("produto")
    .insert({
      titulo: title,
      descricao: "Produto placeholder usado para pedidos Mercado Livre ainda sem vinculo com o estoque.",
      precovenda: 0,
      estoque: 0,
      estoqueminimo: 0,
      unidade: "UN",
      exibirPdv: false,
      tituloMarketplace: title,
      descricaoMarketplace: "Produto sem vinculo de marketplace.",
    })
    .select("id")
    .single();

  if (error) throw error;
  return Number(data.id);
}

function calculateItemsTotal(items: MercadoLivreOrderItem[]) {
  return items.reduce((sum, item) => {
    const quantity = toPositiveInt(item.quantity) ?? 1;
    const unitPrice = Number(item.unit_price ?? item.full_unit_price ?? 0);
    return sum + quantity * unitPrice;
  }, 0);
}

function mapOrderToVendaStatus(order: MercadoLivreOrder): string {
  const normalized = String(order.status ?? "").toLowerCase();
  const paymentSummary = getOrderPaymentSummary(order);
  const paymentStatus = String(paymentSummary.status ?? "").toLowerCase();
  const paymentStatusDetail = String(paymentSummary.statusDetail ?? "").toLowerCase();
  const tags = getOrderTags(order).map((tag) => tag.toLowerCase());
  const feedback = getSaleFeedback(order);
  const isPartialRefund = normalized === "partially_refunded" || paymentStatus === "partially_refunded" || tags.includes("partially_refunded");
  const isNotFulfilled = feedback?.fulfilled === false;

  if (
    normalized === "cancelled" ||
    normalized === "canceled" ||
    normalized === "invalid" ||
    Boolean(order.cancel_detail) ||
    isNotFulfilled ||
    (!isPartialRefund && paymentStatus === "refunded") ||
    paymentStatus === "charged_back" ||
    (!isPartialRefund && paymentStatusDetail.includes("refunded")) ||
    paymentStatusDetail.includes("chargeback") ||
    tags.some((tag) => ["cancelled", "canceled", "unfulfilled", "not_fulfilled"].includes(tag))
  ) {
    return "CANCELADA";
  }

  if (normalized === "paid" || normalized === "partially_refunded") return "FINALIZADA";
  if (["confirmed", "payment_required", "payment_in_process", "partially_paid", "pending_cancel"].includes(normalized)) {
    return paymentStatus === "approved" || paymentStatus === "paid" ? "FINALIZADA" : "PAGAMENTO";
  }
  return "ABERTA";
}

function getOrderPaymentSummary(order: MercadoLivreOrder) {
  const payments = Array.isArray(order.payments) ? order.payments : [];
  const normalizedPayments = payments.filter((payment): payment is Record<string, unknown> => Boolean(payment && typeof payment === "object"));
  const priority = ["charged_back", "refunded", "partially_refunded", "approved", "paid", "in_process", "pending", "rejected", "cancelled", "canceled"];
  const selectedStatus = priority.find((status) =>
    normalizedPayments.some((payment) => String(payment.status ?? "").toLowerCase() === status),
  );
  const selected = selectedStatus
    ? normalizedPayments.find((payment) => String(payment.status ?? "").toLowerCase() === selectedStatus) ?? null
    : normalizedPayments[0] ?? null;

  return {
    status: selected?.status ? String(selected.status) : null,
    statusDetail: selected?.status_detail ? String(selected.status_detail) : null,
    payments: normalizedPayments,
  };
}

function getSaleFeedback(order: MercadoLivreOrder) {
  if (order.feedback_detail && typeof order.feedback_detail === "object") return order.feedback_detail;
  const sale = order.feedback?.sale;
  return sale && typeof sale === "object" ? sale : {};
}

async function hydrateSaleFeedback(accessToken: string, order: MercadoLivreOrder) {
  if (order.feedback_detail && typeof order.feedback_detail === "object") return;
  const sale = order.feedback?.sale;
  if (!sale || typeof sale === "object") return;

  try {
    order.feedback_detail = await mercadoLivreApiGet<Record<string, unknown>>(accessToken, `/feedback/${encodeURIComponent(String(sale))}`);
  } catch (error) {
    console.warn("Falha ao consultar feedback da venda Mercado Livre", { orderId: order.id, feedbackId: sale, error });
  }
}

function getOrderTags(order: MercadoLivreOrder) {
  return Array.isArray(order.tags) ? order.tags.map((tag) => String(tag)).filter(Boolean) : [];
}

function toPositiveInt(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function toNullableNumber(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}
