import { refreshMercadoLivreToken, tokenExpiresAt } from "@/lib/integrations/mercadolivre";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ML_API_BASE_URL = "https://api.mercadolibre.com";

type MercadoLivreAccount = {
  id: number;
  empresa_id: number;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};

export type MercadoLivreShipment = {
  id?: number;
  status?: string | null;
  substatus?: string | null;
  mode?: string | null;
  logistic_type?: string | null;
  tracking_number?: string | null;
  tracking_method?: string | null;
  last_updated?: string | null;
  date_created?: string | null;
  status_history?: Record<string, string | null | undefined>;
  receiver_address?: unknown;
  shipping_option?: unknown;
  [key: string]: unknown;
};

type ShipmentExtraData = {
  costs: unknown;
  items: unknown[];
};

type MercadoLivreOrderRecord = {
  id: number;
  empresa_id: number;
  account_id: number | null;
  venda_id: number | null;
  ml_order_id: number;
  ml_shipment_id?: number | null;
  shipment_status?: string | null;
  shipment_substatus?: string | null;
  shipping_mode?: string | null;
  logistic_type?: string | null;
  tracking_number?: string | null;
  tracking_method?: string | null;
  raw_shipment?: Record<string, unknown> | null;
  raw_order?: {
    shipping?: {
      id?: number | string | null;
    };
  } | null;
};

export async function syncMercadoLivreShipmentForVenda(vendaId: number, empresaId?: number) {
  const order = await getOrderByVendaId(vendaId, empresaId);
  if (!order) throw new Error("Pedido Mercado Livre não encontrado para esta venda.");

  const shipmentId = getShipmentId(order);
  if (!shipmentId) throw new Error("Este pedido Mercado Livre não possui envio vinculado.");

  const account = await getAccount(order);
  const accessToken = await ensureValidAccessToken(account);
  const shipment = await getMercadoLivreShipment(accessToken, shipmentId);
  const extraData = await getShipmentExtraData(accessToken, shipmentId);
  const normalized = normalizeShipment(shipment);

  await persistShipment(order, normalized, shipment, extraData);
  return { order, shipment: normalized, rawShipment: shipment, rawShipmentCosts: extraData.costs, rawShipmentItems: extraData.items };
}

export async function getMercadoLivreShipmentLabelForVenda(vendaId: number, empresaId?: number) {
  const order = await getOrderByVendaId(vendaId, empresaId);
  if (!order) throw new Error("Pedido Mercado Livre não encontrado para esta venda.");

  const shipmentId = getShipmentId(order);
  if (!shipmentId) throw new Error("Este pedido Mercado Livre não possui envio vinculado.");

  const account = await getAccount(order);
  const accessToken = await ensureValidAccessToken(account);
  const response = await fetch(`${ML_API_BASE_URL}/shipment_labels?shipment_ids=${encodeURIComponent(String(shipmentId))}&response_type=pdf`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/pdf",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    if (text.includes("INVALID_SHIPMENT_NO_LOGISTIC") || text.includes("has not logistic type")) {
      throw new Error("Este pedido usa envio personalizado e não possui etiqueta do Mercado Livre. Registre transportadora e rastreio no ERP.");
    }
    throw new Error(`Mercado Livre etiqueta falhou (${response.status}): ${text}`);
  }

  return {
    shipmentId,
    contentType: response.headers.get("content-type") || "application/pdf",
    body: await response.arrayBuffer(),
  };
}

export function normalizeShipment(shipment: MercadoLivreShipment) {
  const status = shipment.status ?? null;
  const substatus = shipment.substatus ?? null;
  const trackingNumber = shipment.tracking_number ?? null;
  const trackingMethod = shipment.tracking_method ?? null;
  const lastUpdated = shipment.last_updated ?? new Date().toISOString();
  const events = buildShipmentEvents(shipment);

  return {
    id: Number(shipment.id),
    status,
    substatus,
    mode: shipment.mode ?? null,
    logisticType: shipment.logistic_type ?? null,
    trackingNumber,
    trackingMethod,
    lastUpdated,
    receiverAddress: shipment.receiver_address ?? null,
    shippingOption: shipment.shipping_option ?? null,
    statusEntrega: mapShipmentStatusToEntrega(status, substatus),
    statusRastreio: mapShipmentStatusToRastreio(status, substatus),
    lastEventTitle: formatShipmentStatus(status, substatus),
    events,
  };
}

export function reconcileShipmentState(
  normalized: ReturnType<typeof normalizeShipment>,
  current?: {
    shipment_status?: string | null;
    shipment_substatus?: string | null;
    shipping_mode?: string | null;
    logistic_type?: string | null;
    tracking_number?: string | null;
    tracking_method?: string | null;
    raw_shipment?: any;
  } | null,
) {
  const currentStatus = String(current?.shipment_status ?? "").toLowerCase();
  const incomingStatus = String(normalized.status ?? "").toLowerCase();
  const customData = current?.raw_shipment?.custom;
  const locallyMarkedAsShipped =
    currentStatus === "shipped" &&
    String(current?.shipping_mode ?? "").toLowerCase() === "custom" &&
    Boolean(customData?.marketplace_status_sent_at);
  const incomingIsProgress = ["shipped", "delivered", "not_delivered", "cancelled", "canceled"].includes(incomingStatus);

  if (!locallyMarkedAsShipped || incomingIsProgress) return normalized;

  return {
    ...normalized,
    status: current?.shipment_status ?? normalized.status,
    substatus: current?.shipment_substatus ?? normalized.substatus,
    mode: current?.shipping_mode ?? normalized.mode,
    logisticType: current?.logistic_type ?? normalized.logisticType,
    trackingNumber: current?.tracking_number ?? normalized.trackingNumber,
    trackingMethod: current?.tracking_method ?? normalized.trackingMethod,
    statusEntrega: "ENVIO",
    statusRastreio: "EM_TRANSITO",
    lastEventTitle: "Enviado",
  };
}

async function getOrderByVendaId(vendaId: number, empresaId?: number) {
  let query = supabaseAdmin
    .from("mercadolivre_order")
    .select(
      "id, empresa_id, account_id, venda_id, ml_order_id, ml_shipment_id, shipment_status, shipment_substatus, shipping_mode, logistic_type, tracking_number, tracking_method, raw_order, raw_shipment",
    )
    .eq("venda_id", vendaId);
  if (empresaId) query = query.eq("empresa_id", empresaId);

  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  return data as MercadoLivreOrderRecord | null;
}

function getShipmentId(order: MercadoLivreOrderRecord) {
  const fromColumn = Number(order.ml_shipment_id);
  if (Number.isFinite(fromColumn) && fromColumn > 0) return Math.trunc(fromColumn);

  const fromOrder = Number(order.raw_order?.shipping?.id);
  if (Number.isFinite(fromOrder) && fromOrder > 0) return Math.trunc(fromOrder);

  return null;
}

async function getAccount(order: MercadoLivreOrderRecord) {
  let query = supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, access_token, refresh_token, expires_at")
    .eq("empresa_id", order.empresa_id);

  if (order.account_id) query = query.eq("id", order.account_id);

  const { data, error } = await query.order("updated_at", { ascending: false }).limit(1).single();
  if (error) throw error;
  return data as MercadoLivreAccount;
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

async function getMercadoLivreShipment(accessToken: string, shipmentId: number) {
  const response = await fetch(`${ML_API_BASE_URL}/shipments/${encodeURIComponent(String(shipmentId))}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "x-format-new": "true",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mercado Livre shipment ${shipmentId} falhou (${response.status}): ${text}`);
  }

  return (await response.json()) as MercadoLivreShipment;
}

async function getShipmentExtraData(accessToken: string, shipmentId: number): Promise<ShipmentExtraData> {
  const [costs, items] = await Promise.all([
    mercadoLivreApiGetOrNull(accessToken, `/shipments/${encodeURIComponent(String(shipmentId))}/costs`),
    mercadoLivreApiGetOrNull(accessToken, `/shipments/${encodeURIComponent(String(shipmentId))}/items`),
  ]);

  return {
    costs: costs ?? {},
    items: Array.isArray(items) ? items : Array.isArray((items as any)?.items) ? (items as any).items : [],
  };
}

async function mercadoLivreApiGetOrNull(accessToken: string, path: string) {
  const response = await fetch(`${ML_API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "x-format-new": "true",
    },
    cache: "no-store",
  });

  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function persistShipment(
  order: MercadoLivreOrderRecord,
  normalized: ReturnType<typeof normalizeShipment>,
  rawShipment: MercadoLivreShipment,
  extraData: ShipmentExtraData,
) {
  const nowIso = new Date().toISOString();
  const effectiveShipment = reconcileShipmentState(normalized, order);
  const shipmentId = effectiveShipment.id;
  const shipmentCost = extractShipmentCost(extraData.costs);
  const mergedRawShipment = {
    ...(rawShipment && typeof rawShipment === "object" ? rawShipment : {}),
    ...(order.raw_shipment?.custom ? { custom: order.raw_shipment.custom } : {}),
  };

  const { error: orderError } = await supabaseAdmin
    .from("mercadolivre_order")
    .update({
      ml_shipment_id: shipmentId,
      shipment_status: effectiveShipment.status,
      shipment_substatus: effectiveShipment.substatus,
      shipping_mode: effectiveShipment.mode,
      logistic_type: effectiveShipment.logisticType,
      tracking_number: effectiveShipment.trackingNumber,
      tracking_method: effectiveShipment.trackingMethod,
      shipment_cost: shipmentCost,
      raw_shipment: mergedRawShipment,
      raw_shipment_costs: extraData.costs ?? {},
      raw_shipment_items: extraData.items ?? [],
      shipment_updated_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", order.id);

  if (orderError) throw orderError;

  if (!order.venda_id) return;

  const vendaPatch: Record<string, unknown> = {
    transportadora_rastreio:
      String(effectiveShipment.mode ?? "").toLowerCase() === "custom"
        ? effectiveShipment.trackingMethod || order.tracking_method || "TRANSPORTADORA"
        : "MERCADO_ENVIOS",
    codigo_rastreio: effectiveShipment.trackingNumber,
    status_rastreio: effectiveShipment.statusRastreio,
    ultimo_evento_rastreio: effectiveShipment.lastEventTitle,
    ultimo_evento_rastreio_em: effectiveShipment.lastUpdated,
    eventos_rastreio: effectiveShipment.events,
    rastreio_atualizado_em: nowIso,
    updatedat: nowIso,
  };

  if (effectiveShipment.statusEntrega) vendaPatch.status_entrega = effectiveShipment.statusEntrega;
  if (effectiveShipment.receiverAddress) vendaPatch.endereco_entrega_snapshot = effectiveShipment.receiverAddress;

  const { error: vendaError } = await supabaseAdmin.from("venda").update(vendaPatch).eq("id", order.venda_id);
  if (vendaError) throw vendaError;
}

function extractShipmentCost(costs: unknown) {
  const data = costs as any;
  const candidates = [
    data?.gross_amount,
    data?.receiver?.cost,
    data?.senders?.[0]?.cost,
    data?.cost,
    data?.list_cost,
    data?.shipping_option?.cost,
  ];
  const value = candidates.map(Number).find((candidate) => Number.isFinite(candidate));
  return value ?? null;
}

function buildShipmentEvents(shipment: MercadoLivreShipment) {
  const history = shipment.status_history ?? {};
  const events: Array<{ at: string | null; title: string; location: string | null; details: string | null }> = Object.entries(history)
    .filter(([, value]) => value)
    .map(([key, value]) => ({
      at: value ?? null,
      title: formatHistoryKey(key),
      location: null,
      details: null,
    }))
    .sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());

  if (!events.length) {
    events.push({
      at: shipment.last_updated ?? shipment.date_created ?? null,
      title: formatShipmentStatus(shipment.status, shipment.substatus),
      location: null,
      details: shipment.tracking_method ?? null,
    });
  }

  return events;
}

function mapShipmentStatusToEntrega(status?: string | null, substatus?: string | null) {
  const normalized = String(status ?? "").toLowerCase();
  const normalizedSubstatus = String(substatus ?? "").toLowerCase();

  if (normalized === "delivered") return "ENTREGUE";
  if (["shipped", "handling"].includes(normalized)) return "ENVIO";
  if (["ready_to_ship", "pending"].includes(normalized)) return "SEPARACAO";
  if (normalizedSubstatus.includes("delivered")) return "ENTREGUE";
  return null;
}

function mapShipmentStatusToRastreio(status?: string | null, substatus?: string | null) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "delivered") return "ENTREGUE";
  if (normalized === "shipped") return "EM_TRANSITO";
  if (normalized === "ready_to_ship") return "PRONTO_PARA_ENVIO";
  if (normalized === "handling") return "EM_PREPARACAO";
  if (normalized === "cancelled") return "CANCELADO";
  return substatus ? String(substatus).toUpperCase() : normalized ? normalized.toUpperCase() : null;
}

function formatShipmentStatus(status?: string | null, substatus?: string | null) {
  const base = formatHistoryKey(status || "Sem status");
  return substatus ? `${base} - ${formatHistoryKey(substatus)}` : base;
}

function formatHistoryKey(value: string) {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
