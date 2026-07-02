import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getMercadoLivreOrder,
  refreshMercadoLivreToken,
  searchMercadoLivreOrders,
  tokenExpiresAt,
  type MercadoLivreOrder,
  type MercadoLivreOrderItem,
} from "@/lib/integrations/mercadolivre";

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
};

export async function syncMercadoLivreOrders(params?: { accountId?: number; days?: number; limit?: number }) {
  const accounts = await getAccounts(params?.accountId);
  const results: ImportResult[] = [];

  for (const account of accounts) {
    const accessToken = await ensureValidAccessToken(account);
    const dateFrom = new Date(Date.now() - (params?.days ?? 15) * 24 * 60 * 60 * 1000).toISOString();
    const limit = Math.min(Math.max(params?.limit ?? 50, 1), 50);

    const search = await searchMercadoLivreOrders(accessToken, {
      sellerId: account.ml_user_id,
      limit,
      orderDateFrom: dateFrom,
    });

    for (const summary of search.results ?? []) {
      const orderId = Number(summary.id);
      if (!Number.isFinite(orderId)) continue;

      const order = await getMercadoLivreOrder(accessToken, orderId);
      const result = await importMercadoLivreOrder(account, order);
      results.push(result);
    }
  }

  return results;
}

export async function importMercadoLivreOrder(account: MercadoLivreAccount, order: MercadoLivreOrder) {
  const mlOrderId = Number(order.id);
  if (!Number.isFinite(mlOrderId)) {
    return { mlOrderId: 0, vendaId: null, created: false, skipped: "Pedido sem id valido." };
  }

  const existing = await findExistingOrder(mlOrderId);
  if (existing?.venda_id) {
    await upsertOrderRecord(account, order, existing.venda_id);
    return { mlOrderId, vendaId: existing.venda_id, created: false, skipped: "Venda ja importada." };
  }

  const clienteId = await getOrCreateMarketplaceCustomer();
  const vendaPayload = buildVendaPayload(clienteId, order);

  const { data: venda, error: vendaError } = await supabaseAdmin
    .from("venda")
    .insert(vendaPayload)
    .select("id")
    .single();

  if (vendaError) throw vendaError;

  const vendaId = Number(venda.id);
  const orderItems = Array.isArray(order.order_items) ? order.order_items : [];

  for (const item of orderItems) {
    const produtoId = await resolveProdutoId(account.empresa_id, item);
    const quantity = toPositiveInt(item.quantity) ?? 1;
    const unitPrice = Number(item.unit_price ?? item.full_unit_price ?? 0);
    const itemTotal = Number((unitPrice * quantity).toFixed(2));

    const { error: itemError } = await supabaseAdmin.from("vendaproduto").insert({
      venda_id: vendaId,
      produtoid: produtoId,
      quantidade: quantity,
      sub_total: itemTotal,
      valor_total: itemTotal,
      valor_desconto: null,
      tipo_desconto: null,
    });

    if (itemError) throw itemError;
  }

  await upsertOrderRecord(account, order, vendaId);
  return { mlOrderId, vendaId, created: true };
}

async function getAccounts(accountId?: number) {
  let query = supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, ml_user_id, access_token, refresh_token, expires_at")
    .order("updated_at", { ascending: false });

  if (accountId) query = query.eq("id", accountId);

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
    .select("id, venda_id")
    .eq("ml_order_id", mlOrderId)
    .maybeSingle();

  if (error) throw error;
  return data as { id: number; venda_id: number | null } | null;
}

async function upsertOrderRecord(account: MercadoLivreAccount, order: MercadoLivreOrder, vendaId: number | null) {
  const { error } = await supabaseAdmin.from("mercadolivre_order").upsert(
    {
      empresa_id: account.empresa_id,
      account_id: account.id,
      venda_id: vendaId,
      ml_order_id: Number(order.id),
      status: order.status ?? null,
      date_created: order.date_created ?? null,
      total_amount: Number(order.total_amount ?? order.paid_amount ?? 0),
      currency_id: order.currency_id ?? null,
      buyer_id: order.buyer?.id ?? null,
      raw_order: order,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "ml_order_id" },
  );

  if (error) throw error;
}

async function getOrCreateMarketplaceCustomer() {
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

function buildVendaPayload(clienteId: number, order: MercadoLivreOrder) {
  const total = Number(order.total_amount ?? order.paid_amount ?? calculateItemsTotal(order.order_items ?? []));
  const status = mapOrderStatusToVendaStatus(order.status);
  const externalId = Number(order.id);

  return {
    clienteid: clienteId,
    status,
    canal: "MERCADO_LIVRE",
    status_entrega: status === "PAGO" || status === "FINALIZADA" ? "SEPARACAO" : null,
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
    if (data?.produto_id) return Number(data.produto_id);
  }

  return getOrCreatePlaceholderProduct();
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

function mapOrderStatusToVendaStatus(status?: string): string {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "cancelled" || normalized === "canceled") return "CANCELADA";
  if (normalized === "paid") return "PAGO";
  if (normalized === "confirmed" || normalized === "payment_required") return "PAGAMENTO";
  return "ABERTA";
}

function toPositiveInt(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}
