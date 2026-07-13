import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getMercadoLivreOrder,
  refreshMercadoLivreToken,
  searchMercadoLivreOrders,
  tokenExpiresAt,
  type MercadoLivreOrder,
  type MercadoLivreOrderItem,
} from "@/lib/integrations/mercadolivre";
import { normalizeShipment, reconcileShipmentState, type MercadoLivreShipment } from "@/lib/integrations/mercadolivre-shipping";

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
    const limit = Math.min(Math.max(params?.limit ?? 50, 1), 50);

    let search = await searchMercadoLivreOrders(accessToken, {
      sellerId: account.ml_user_id,
      limit,
      orderDateFrom: dateFrom,
    });

    if (!search.results?.length) {
      search = await searchMercadoLivreOrders(accessToken, {
        sellerId: account.ml_user_id,
        limit,
      });
    }

    for (const summary of search.results ?? []) {
      const orderId = Number(summary.id);
      if (!Number.isFinite(orderId)) continue;

      try {
        const order = await getMercadoLivreOrder(accessToken, orderId);
        const result = await importMercadoLivreOrder(account, order);
        results.push(result);
      } catch (e: any) {
        results.push({
          mlOrderId: orderId,
          vendaId: null,
          created: false,
          error: e?.message || "Falha ao importar pedido.",
        });
      }
    }
  }

  return results;
}

export async function importMercadoLivreOrder(account: MercadoLivreAccount, order: MercadoLivreOrder) {
  const mlOrderId = Number(order.id);
  if (!Number.isFinite(mlOrderId)) {
    return { mlOrderId: 0, vendaId: null, created: false, skipped: "Pedido sem id valido." };
  }

  const accessToken = await ensureValidAccessToken(account);
  const shipment = await fetchOrderShipment(accessToken, order);
  const shouldDecrementStock = mapOrderToVendaStatus(order) === "FINALIZADA";
  const existing = await findExistingOrder(mlOrderId);
  if (existing?.venda_id) {
    await upsertOrderRecord(account, order, existing.venda_id, shipment, existing);
    await updateVendaOrderStatus(existing.venda_id, order);
    if (mapOrderToVendaStatus(order) === "CANCELADA") {
      await restoreMarketplaceStockDecrement(existing.venda_id);
    }
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
    const current = await findExistingOrder(mlOrderId);
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

async function findExistingOrder(mlOrderId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_order")
    .select(
      "id, venda_id, shipment_status, shipment_substatus, shipping_mode, logistic_type, tracking_number, tracking_method, raw_shipment",
    )
    .eq("ml_order_id", mlOrderId)
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
  const { error } = await supabaseAdmin.from("mercadolivre_order").upsert(
    {
      empresa_id: account.empresa_id,
      account_id: account.id,
      venda_id: vendaId,
      ml_order_id: Number(order.id),
      status: order.status ?? null,
      status_detail: typeof order.status_detail === "string" ? order.status_detail : null,
      payment_status: paymentSummary.status,
      payment_status_detail: paymentSummary.statusDetail,
      order_tags: tags,
      date_closed: typeof order.date_closed === "string" ? order.date_closed : null,
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

async function updateVendaOrderStatus(vendaId: number, order: MercadoLivreOrder) {
  const status = mapOrderToVendaStatus(order);
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

async function restoreMarketplaceStockDecrement(vendaId: number) {
  const { data: baixas, error: baixasError } = await supabaseAdmin
    .from("vendaproduto_baixa")
    .select("produtoid, quantidade")
    .eq("venda_id", vendaId);

  if (baixasError) throw baixasError;
  if (!baixas?.length) return;

  for (const baixa of baixas) {
    const produtoId = Number((baixa as any).produtoid);
    const quantidade = Number((baixa as any).quantidade ?? 0);
    if (!Number.isFinite(produtoId) || produtoId <= 0 || !Number.isFinite(quantidade) || quantidade <= 0) continue;

    const { error: restoreError } = await supabaseAdmin.rpc("fn_sincronizar_baixa_estoque_marketplace", {
      p_venda_id: vendaId,
      p_produto_id: produtoId,
      p_quantidade_alvo: 0,
    });
    if (restoreError) throw restoreError;
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

  if (
    normalized === "cancelled" ||
    normalized === "canceled" ||
    paymentStatus === "refunded" ||
    paymentStatus === "charged_back" ||
    paymentStatusDetail.includes("refund") ||
    paymentStatusDetail.includes("chargeback") ||
    tags.some((tag) => tag.includes("cancel") || tag.includes("refund"))
  ) {
    return "CANCELADA";
  }

  if (normalized === "paid") return "FINALIZADA";
  if (normalized === "confirmed" || normalized === "payment_required") return "PAGAMENTO";
  return "ABERTA";
}

function getOrderPaymentSummary(order: MercadoLivreOrder) {
  const payments = Array.isArray(order.payments) ? order.payments : [];
  const normalizedPayments = payments.filter((payment): payment is Record<string, unknown> => Boolean(payment && typeof payment === "object"));
  const priority = ["refunded", "charged_back", "rejected", "cancelled", "canceled", "approved", "paid", "pending", "in_process"];
  const selected =
    normalizedPayments.find((payment) => priority.includes(String(payment.status ?? "").toLowerCase())) ??
    normalizedPayments[0] ??
    null;

  return {
    status: selected?.status ? String(selected.status) : null,
    statusDetail: selected?.status_detail ? String(selected.status_detail) : null,
    payments: normalizedPayments,
  };
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
