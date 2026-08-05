import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ensureValidShopeeAccount, type ShopeeAccount } from "@/lib/integrations/shopee-account";
import { shopeeShopApi } from "@/lib/integrations/shopee";

type ShopeeOrder = {
  order_sn: string;
  order_status?: string;
  create_time?: number;
  update_time?: number;
  total_amount?: number;
  currency?: string;
  payment_method?: string;
  buyer_user_id?: number;
  buyer_username?: string;
  tracking_number?: string;
  shipping_carrier?: string;
  recipient_address?: Record<string, any>;
  item_list?: Array<{
    item_id?: number;
    model_id?: number;
    item_name?: string;
    model_name?: string;
    item_sku?: string;
    model_sku?: string;
    model_quantity_purchased?: number;
    model_discounted_price?: number;
    model_original_price?: number;
  }>;
  [key: string]: unknown;
};

export type ShopeeImportResult = {
  orderSn: string;
  vendaId: number | null;
  created: boolean;
  skipped?: string;
  error?: string;
};

export async function syncShopeeOrders(params: { empresaId: number; accountId?: number; days?: number }) {
  const account = await getAccount(params.empresaId, params.accountId);
  const validAccount = await ensureValidShopeeAccount(account);
  const now = Math.floor(Date.now() / 1000);
  const timeFrom = now - Math.min(Math.max(params.days ?? 15, 1), 15) * 86400;
  const orderSns = await listUpdatedOrderSns(validAccount, timeFrom, now);
  const results: ShopeeImportResult[] = [];

  for (let index = 0; index < orderSns.length; index += 50) {
    const batch = orderSns.slice(index, index + 50);
    try {
      const detail = await shopeeShopApi<{ response?: { order_list?: ShopeeOrder[] } }>({
        path: "/api/v2/order/get_order_detail",
        accessToken: validAccount.access_token,
        shopId: validAccount.shop_id,
        query: {
          order_sn_list: batch.join(","),
          response_optional_fields: "buyer_user_id,buyer_username,recipient_address,item_list,total_amount,payment_method,shipping_carrier,package_list",
        },
      });
      for (const order of detail.response?.order_list ?? []) {
        try {
          results.push(await importShopeeOrder(validAccount, order));
        } catch (error: any) {
          results.push({ orderSn: order.order_sn, vendaId: null, created: false, error: error?.message || "Falha ao importar pedido Shopee." });
        }
      }
    } catch (error: any) {
      for (const orderSn of batch) {
        results.push({ orderSn, vendaId: null, created: false, error: error?.message || "Falha ao consultar pedido Shopee." });
      }
    }
  }
  return results;
}

async function listUpdatedOrderSns(account: ShopeeAccount, timeFrom: number, timeTo: number) {
  const orderSns = new Set<string>();
  let cursor = "";
  for (let page = 0; page < 100; page += 1) {
    const result = await shopeeShopApi<{
      response?: { order_list?: Array<{ order_sn?: string }>; more?: boolean; next_cursor?: string };
    }>({
      path: "/api/v2/order/get_order_list",
      accessToken: account.access_token,
      shopId: account.shop_id,
      query: {
        time_range_field: "update_time",
        time_from: timeFrom,
        time_to: timeTo,
        page_size: 100,
        cursor: cursor || undefined,
      },
    });
    for (const row of result.response?.order_list ?? []) {
      if (row.order_sn) orderSns.add(String(row.order_sn));
    }
    if (!result.response?.more || !result.response.next_cursor) break;
    cursor = result.response.next_cursor;
  }
  return Array.from(orderSns);
}

export async function importShopeeOrder(account: ShopeeAccount, order: ShopeeOrder): Promise<ShopeeImportResult> {
  const orderSn = String(order.order_sn ?? "").trim();
  if (!orderSn) return { orderSn: "", vendaId: null, created: false, skipped: "Pedido sem código." };
  const existing = await findOrder(account.empresa_id, orderSn);
  await upsertOrder(account, order, existing?.venda_id ?? null);

  if (existing?.venda_id) {
    await updateVendaStatus(existing.venda_id, order);
    await reconcileStock(existing.venda_id, account.empresa_id, order);
    return { orderSn, vendaId: existing.venda_id, created: false, skipped: "Venda já importada." };
  }

  const { data: reserved, error: reserveError } = await supabaseAdmin.rpc("fn_reservar_importacao_shopee", {
    p_order_sn: orderSn,
    p_empresa_id: account.empresa_id,
  });
  if (reserveError) throw reserveError;
  if (!reserved) {
    const current = await findOrder(account.empresa_id, orderSn);
    return { orderSn, vendaId: current?.venda_id ?? null, created: false, skipped: "Pedido já reservado ou importado." };
  }

  try {
    const clienteId = await getOrCreateCustomer(order, account.shop_id);
    const status = mapOrderStatus(order.order_status);
    const items = [];
    for (const item of order.item_list ?? []) {
      const resolved = await resolveProduct(account.empresa_id, item);
      const quantity = positiveInt(item.model_quantity_purchased) ?? 1;
      const price = Number(item.model_discounted_price ?? item.model_original_price ?? 0);
      items.push({
        produtoId: resolved.produtoId,
        quantidade: quantity,
        subTotal: Number((price * quantity).toFixed(2)),
        valorTotal: Number((price * quantity).toFixed(2)),
        baixarEstoque: resolved.linked && status === "FINALIZADA",
      });
    }
    const total = Number(order.total_amount ?? items.reduce((sum, item) => sum + item.valorTotal, 0));
    const { data: vendaIdData, error } = await supabaseAdmin.rpc("fn_criar_venda_shopee_reservada", {
      p_order_sn: orderSn,
      p_empresa_id: account.empresa_id,
      p_venda: {
        clienteId,
        status,
        canal: "SHOPEE",
        statusEntrega: status === "FINALIZADA" ? "SEPARACAO" : null,
        valorTotal: total,
        subTotal: total,
        descontoTipo: null,
        descontoValor: null,
        formaPagamento: order.payment_method || "SHOPEE",
        dataVenda: fromUnix(order.create_time) ?? new Date().toISOString(),
        observacoes: `Pedido Shopee #${orderSn}`,
        itens: items,
      },
    });
    if (error) throw error;
    const vendaId = Number(vendaIdData);
    await upsertOrder(account, order, vendaId);
    return { orderSn, vendaId, created: true };
  } catch (error: any) {
    await supabaseAdmin.from("shopee_order").update({
      import_status: "ERRO",
      import_locked_at: null,
      import_error: error?.message || "Falha ao importar pedido.",
      updated_at: new Date().toISOString(),
    }).eq("empresa_id", account.empresa_id).eq("order_sn", orderSn);
    throw error;
  }
}

async function getAccount(empresaId: number, accountId?: number) {
  let query = supabaseAdmin.from("shopee_account")
    .select("id, empresa_id, shop_id, shop_name, access_token, refresh_token, expires_at")
    .eq("empresa_id", empresaId);
  if (accountId) query = query.eq("id", accountId);
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(1).single();
  if (error) throw error;
  return data as ShopeeAccount;
}

async function findOrder(empresaId: number, orderSn: string) {
  const { data, error } = await supabaseAdmin.from("shopee_order").select("id, venda_id")
    .eq("empresa_id", empresaId).eq("order_sn", orderSn).maybeSingle();
  if (error) throw error;
  return data as { id: number; venda_id: number | null } | null;
}

async function upsertOrder(account: ShopeeAccount, order: ShopeeOrder, vendaId: number | null) {
  const packageData = Array.isArray(order.package_list) ? order.package_list[0] as any : null;
  const { error } = await supabaseAdmin.from("shopee_order").upsert({
    empresa_id: account.empresa_id,
    account_id: account.id,
    venda_id: vendaId,
    order_sn: order.order_sn,
    status: order.order_status ?? null,
    buyer_user_id: order.buyer_user_id ?? null,
    buyer_username: order.buyer_username ?? null,
    currency: order.currency ?? "BRL",
    total_amount: Number(order.total_amount ?? 0),
    payment_method: order.payment_method ?? null,
    tracking_number: order.tracking_number ?? packageData?.tracking_number ?? null,
    shipping_carrier: order.shipping_carrier ?? packageData?.shipping_carrier ?? null,
    create_time: fromUnix(order.create_time),
    update_time: fromUnix(order.update_time),
    raw_order: order,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "empresa_id,order_sn" });
  if (error) throw error;
}

async function getOrCreateCustomer(order: ShopeeOrder, shopId: number) {
  const buyerId = Number(order.buyer_user_id ?? 0);
  const document = buyerId > 0 ? `SH${buyerId}` : `SHLOJA${shopId}`;
  const { data: existing, error: selectError } = await supabaseAdmin.from("cliente").select("id").eq("cpfcnpj", document).maybeSingle();
  if (selectError) throw selectError;
  if (existing?.id) return Number(existing.id);
  const address = order.recipient_address ?? {};
  const name = String(address.name || order.buyer_username || `Comprador Shopee #${buyerId || shopId}`);
  const { data, error } = await supabaseAdmin.from("cliente").insert({
    tipopessoa: "FISICA",
    cpfcnpj: document,
    nomerazaosocial: name,
    email: `shopee-${buyerId || shopId}@marketplace.local`,
    telefone: String(address.phone || document),
    endereco: address.full_address || address.town || null,
    bairro: address.district || null,
    cidade: address.city || "Não informado",
    estado: address.state || "NI",
    cep: address.zipcode || null,
    status: "ATIVO",
  }).select("id").single();
  if (!error) return Number(data.id);
  if (error.code === "23505") {
    const { data: concurrent, error: retryError } = await supabaseAdmin.from("cliente").select("id").eq("cpfcnpj", document).single();
    if (retryError) throw retryError;
    return Number(concurrent.id);
  }
  throw error;
}

async function resolveProduct(empresaId: number, item: NonNullable<ShopeeOrder["item_list"]>[number]) {
  let query = supabaseAdmin.from("shopee_product_link").select("produto_id")
    .eq("empresa_id", empresaId).eq("item_id", Number(item.item_id));
  if (item.model_id) query = query.eq("model_id", Number(item.model_id));
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (data?.produto_id) return { produtoId: Number(data.produto_id), linked: true };
  return { produtoId: await getPlaceholderProduct(), linked: false };
}

async function getPlaceholderProduct() {
  const title = "Produto Shopee sem vínculo";
  const { data: existing, error: selectError } = await supabaseAdmin.from("produto").select("id").eq("titulo", title).maybeSingle();
  if (selectError) throw selectError;
  if (existing?.id) return Number(existing.id);
  const { data, error } = await supabaseAdmin.from("produto").insert({
    titulo: title,
    descricao: "Produto temporário para pedidos Shopee ainda sem vínculo com o estoque.",
    precovenda: 0,
    estoque: 0,
    estoqueminimo: 0,
    unidade: "UN",
    exibirPdv: false,
    tituloMarketplace: title,
    descricaoMarketplace: "Produto sem vínculo de marketplace.",
  }).select("id").single();
  if (error) throw error;
  return Number(data.id);
}

async function updateVendaStatus(vendaId: number, order: ShopeeOrder) {
  const status = mapOrderStatus(order.order_status);
  const { error } = await supabaseAdmin.from("venda").update({
    status,
    ...(status === "CANCELADA" ? { status_entrega: null } : {}),
    updatedat: new Date().toISOString(),
  }).eq("id", vendaId);
  if (error) throw error;
}

async function reconcileStock(vendaId: number, empresaId: number, order: ShopeeOrder) {
  const targetStatus = mapOrderStatus(order.order_status);
  if (targetStatus === "CANCELADA") {
    const { data, error } = await supabaseAdmin.from("vendaproduto_baixa").select("produtoid").eq("venda_id", vendaId);
    if (error) throw error;
    for (const row of data ?? []) {
      const { error: rpcError } = await supabaseAdmin.rpc("fn_sincronizar_baixa_estoque_marketplace", {
        p_venda_id: vendaId, p_produto_id: Number(row.produtoid), p_quantidade_alvo: 0,
      });
      if (rpcError) throw rpcError;
    }
    return;
  }
  if (targetStatus !== "FINALIZADA") return;
  const quantities = new Map<number, number>();
  for (const item of order.item_list ?? []) {
    const resolved = await resolveProduct(empresaId, item);
    if (!resolved.linked) continue;
    quantities.set(resolved.produtoId, (quantities.get(resolved.produtoId) ?? 0) + (positiveInt(item.model_quantity_purchased) ?? 1));
  }
  for (const [produtoId, quantity] of quantities) {
    const { error } = await supabaseAdmin.rpc("fn_sincronizar_baixa_estoque_marketplace", {
      p_venda_id: vendaId, p_produto_id: produtoId, p_quantidade_alvo: quantity,
    });
    if (error) throw error;
  }
}

function mapOrderStatus(value?: string) {
  const status = String(value ?? "").toUpperCase();
  if (["CANCELLED", "IN_CANCEL"].includes(status)) return "CANCELADA";
  if (["READY_TO_SHIP", "PROCESSED", "SHIPPED", "TO_CONFIRM_RECEIVE", "COMPLETED"].includes(status)) return "FINALIZADA";
  if (status === "UNPAID") return "PAGAMENTO";
  return "ABERTA";
}

function positiveInt(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

function fromUnix(value?: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number * 1000).toISOString() : null;
}
