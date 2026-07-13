import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess, requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { getMercadoLivreOrder, refreshMercadoLivreToken, tokenExpiresAt } from "@/lib/integrations/mercadolivre";
import { importMercadoLivreOrder } from "@/lib/integrations/mercadolivre-orders";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POST_PURCHASE_API_BASE_URL = "https://api.mercadolibre.com";

type MercadoLivreAccount = {
  id: number;
  empresa_id: number;
  ml_user_id: number;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};

type MercadoLivreOrderRow = {
  id: number;
  empresa_id: number;
  ml_order_id: number;
  ml_shipment_id: number | null;
};

type NormalizedClaim = {
  id: string;
  orderDbId: number;
  mlOrderId: number;
  mlShipmentId: number | null;
  status: string | null;
  stage: string | null;
  type: string | null;
  reason: string | null;
  title: string;
  dueDate: string | null;
  closedAt: string | null;
  resolution: string | null;
  availableActions: any[];
  players: any[];
  resource: string | null;
  raw: any;
  error: string | null;
};

type MercadoLivreNotificationRow = {
  id: number;
  topic: string | null;
  resource: string | null;
  raw_payload: any;
  created_at: string | null;
};

export async function GET(req: NextRequest) {
  try {
    await requireVendasAccess();

    const orderDbId = Number(req.nextUrl.searchParams.get("orderDbId") ?? 0);
    const mlOrderId = Number(req.nextUrl.searchParams.get("mlOrderId") ?? 0);
    const account = await getActiveAccount(await requireEmpresaId());
    const accessToken = await ensureValidAccessToken(account);
    const orders = await getOrders(account.empresa_id, orderDbId, mlOrderId);
    const notifications = await getClaimNotifications(account);
    const searchedClaims = await searchClaims(accessToken);
    const candidates = dedupeClaimCandidates([
      ...searchedClaims.map((claim: any) => ({ source: "search", claim, claimId: String(claim?.id ?? "") })),
      ...notifications.map((notification) => ({ source: "notification", notification, claimId: getClaimId(notification) })),
    ]);

    const claims = await Promise.all(
      candidates.map(async (candidate) => {
        const claimId = candidate.claimId;
        if (!claimId) return null;

        try {
          const searchOrder = candidate.claim ? findRelatedOrder(candidate.claim, orders) : null;
          const detail = await postPurchaseApiGet<any>(accessToken, `/post-purchase/v1/claims/${encodeURIComponent(claimId)}`);
          const order = searchOrder ?? findRelatedOrder(detail, orders);
          if (!order) return null;

          return normalizeClaim(claimId, { ...candidate.claim, ...detail }, candidate.notification?.resource ?? candidate.claim?.resource ?? null, order);
        } catch (e: any) {
          console.warn("Falha ao carregar detalhe da reclamação Mercado Livre", {
            claimId,
            notificationId: candidate.notification?.id,
            error: friendlyError(e, "Não foi possível carregar o detalhe da reclamação."),
          });
          return null;
        }
      }),
    );

    const filteredClaims = claims.filter(Boolean) as NormalizedClaim[];
    if (filteredClaims.length > 0) {
      await persistClaims(account, filteredClaims);
      await syncOrdersFromClaims(account, accessToken, filteredClaims);
    }
    const storedClaims = await getStoredClaims(account.empresa_id, orderDbId, mlOrderId);

    return NextResponse.json({ data: storedClaims.map(normalizeStoredClaim) });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/claims", e);
    return NextResponse.json({ error: friendlyError(e, "Falha ao carregar reclamações Mercado Livre.") }, { status: errorStatus(e) });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireVendasEdit();
    const empresaId = await requireEmpresaId();
    const body = await req.json().catch(() => ({}));
    const claimId = String(body?.claimId ?? "").trim();
    const action = String(body?.action ?? "").trim().toLowerCase();
    if (!claimId) return NextResponse.json({ error: "Informe a reclamação." }, { status: 400 });

    const actionConfig: Record<string, { availableNames: string[]; path: string }> = {
      refund: { availableNames: ["refund", "allow_refund"], path: "expected-resolutions/refund" },
      allow_return: { availableNames: ["allow_return", "return_product"], path: "expected-resolutions/allow-return" },
      return_review_ok: { availableNames: ["return_review_ok"], path: "actions/return-review-ok" },
    };
    const config = actionConfig[action];
    if (!config) return NextResponse.json({ error: "Ação de reclamação não suportada pelo ERP." }, { status: 400 });

    const account = await getActiveAccount(empresaId);
    const accessToken = await ensureValidAccessToken(account);
    const claim = await postPurchaseApiGet<any>(accessToken, `/post-purchase/v1/claims/${encodeURIComponent(claimId)}`);
    const sellerActions = getSellerAvailableActionNames(claim, account.ml_user_id);
    if (!config.availableNames.some((name) => sellerActions.includes(name))) {
      return NextResponse.json({ error: "O Mercado Livre não disponibiliza esta ação para o vendedor nesta reclamação." }, { status: 409 });
    }

    const result = await postPurchaseApiPost<any>(
      accessToken,
      `/post-purchase/v1/claims/${encodeURIComponent(claimId)}/${config.path}`,
    );
    return NextResponse.json({ ok: true, data: result });
  } catch (e: any) {
    console.error("POST /api/integracoes/mercadolivre/claims", e);
    return NextResponse.json({ error: friendlyError(e, "Falha ao executar ação na reclamação.") }, { status: errorStatus(e) });
  }
}

async function getActiveAccount(empresaId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, ml_user_id, access_token, refresh_token, expires_at")
    .eq("empresa_id", empresaId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

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

async function getOrders(empresaId: number, orderDbId: number, mlOrderId: number) {
  let query = supabaseAdmin
    .from("mercadolivre_order")
    .select("id, empresa_id, ml_order_id, ml_shipment_id")
    .eq("empresa_id", empresaId)
    .limit(50);

  if (Number.isFinite(orderDbId) && orderDbId > 0) query = query.eq("id", orderDbId);
  if (Number.isFinite(mlOrderId) && mlOrderId > 0) query = query.eq("ml_order_id", mlOrderId);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as MercadoLivreOrderRow[];
}

async function getClaimNotifications(account: MercadoLivreAccount) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_notification")
    .select("id, topic, resource, raw_payload, created_at")
    .eq("ml_user_id", account.ml_user_id)
    .or("topic.ilike.%claim%,topic.ilike.%claims%,topic.ilike.%reclama%")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []) as MercadoLivreNotificationRow[];
}

function getClaimId(notification: MercadoLivreNotificationRow) {
  const resource = String(notification.resource || notification.raw_payload?.resource || "");
  const fromResource = resource.split("/").filter(Boolean).pop();
  const fromPayload = notification.raw_payload?.claim_id || notification.raw_payload?.id || notification.raw_payload?.data?.id;
  return String(fromPayload || fromResource || "").trim();
}

function findRelatedOrder(detail: any, orders: MercadoLivreOrderRow[]) {
  const raw = JSON.stringify(detail ?? {});
  const resourceId = Number(detail?.resource_id ?? detail?.resource?.id ?? 0);
  return (
    orders.find((order) => Number(order.ml_shipment_id ?? 0) > 0 && Number(order.ml_shipment_id) === resourceId) ??
    orders.find((order) => Number(order.ml_order_id) === resourceId) ??
    orders.find((order) => raw.includes(String(order.ml_order_id))) ??
    null
  );
}

function normalizeClaim(claimId: string, detail: any, resource: string | null, order: MercadoLivreOrderRow): NormalizedClaim {
  return {
    id: String(detail?.id ?? claimId),
    orderDbId: order.id,
    mlOrderId: order.ml_order_id,
    mlShipmentId: order.ml_shipment_id ?? null,
    status: detail?.status ?? detail?.stage ?? null,
    stage: detail?.stage ?? null,
    type: detail?.type ?? detail?.reason?.type ?? null,
    reason: detail?.reason?.name ?? detail?.reason?.description ?? detail?.reason_id ?? null,
    title: detail?.title ?? detail?.reason?.name ?? "Reclamação Mercado Livre",
    dueDate: detail?.due_date ?? detail?.expiration_date ?? detail?.deadline ?? null,
    closedAt: detail?.closed_at ?? detail?.date_closed ?? (String(detail?.status ?? "").toLowerCase() === "closed" ? detail?.last_updated : null) ?? null,
    resolution: getClaimResolution(detail),
    availableActions: getClaimAvailableActions(detail),
    players: Array.isArray(detail?.players) ? detail.players : [],
    resource,
    raw: detail,
    error: null,
  };
}

async function persistClaims(account: MercadoLivreAccount, claims: NormalizedClaim[]) {
  const nowIso = new Date().toISOString();
  const rows = claims.map((claim) => ({
    empresa_id: account.empresa_id,
    account_id: account.id,
    order_id: claim.orderDbId,
    ml_order_id: claim.mlOrderId,
    ml_shipment_id: claim.mlShipmentId,
    ml_claim_id: claim.id,
    status: claim.status,
    stage: claim.stage,
    claim_type: claim.type,
    reason: claim.reason,
    title: claim.title,
    due_date: claim.dueDate,
    closed_at: claim.closedAt,
    resolution: claim.resolution,
    available_actions: claim.availableActions,
    players: claim.players,
    resource: claim.resource,
    raw_claim: claim.raw ?? {},
    last_error: claim.error,
    synced_at: nowIso,
    updated_at: nowIso,
  }));

  const { error } = await supabaseAdmin.from("mercadolivre_claim").upsert(rows, { onConflict: "ml_claim_id" });
  if (error) throw error;
}

async function syncOrdersFromClaims(account: MercadoLivreAccount, accessToken: string, claims: NormalizedClaim[]) {
  const orderIds = Array.from(new Set(claims.map((claim) => claim.mlOrderId).filter((id) => Number.isFinite(id) && id > 0)));

  for (const orderId of orderIds) {
    try {
      const order = await getMercadoLivreOrder(accessToken, orderId);
      await importMercadoLivreOrder({ ...account, access_token: accessToken }, order);
    } catch (error) {
      console.warn("Falha ao sincronizar pedido vinculado à reclamação Mercado Livre", {
        orderId,
        error: friendlyError(error, "Falha ao sincronizar pedido."),
      });
    }
  }
}

async function getStoredClaims(empresaId: number, orderDbId: number, mlOrderId: number) {
  let query = supabaseAdmin
    .from("mercadolivre_claim")
    .select("id, order_id, ml_order_id, ml_shipment_id, ml_claim_id, status, stage, claim_type, reason, title, due_date, closed_at, resolution, available_actions, players, resource, raw_claim, last_error, synced_at")
    .eq("empresa_id", empresaId)
    .order("synced_at", { ascending: false })
    .limit(100);

  if (Number.isFinite(orderDbId) && orderDbId > 0) query = query.eq("order_id", orderDbId);
  if (Number.isFinite(mlOrderId) && mlOrderId > 0) query = query.eq("ml_order_id", mlOrderId);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

function normalizeStoredClaim(claim: any) {
  return {
    id: String(claim.ml_claim_id),
    orderDbId: claim.order_id ?? null,
    mlOrderId: claim.ml_order_id ?? null,
    mlShipmentId: claim.ml_shipment_id ?? null,
    status: claim.status ?? claim.stage ?? null,
    stage: claim.stage ?? null,
    type: claim.claim_type ?? null,
    reason: claim.reason ?? null,
    title: claim.title ?? "Reclamação Mercado Livre",
    dueDate: claim.due_date ?? null,
    closedAt: claim.closed_at ?? null,
    resolution: claim.resolution ?? null,
    availableActions: Array.isArray(claim.available_actions) ? claim.available_actions : [],
    players: Array.isArray(claim.players) ? claim.players : [],
    resource: claim.resource ?? null,
    raw: claim.raw_claim ?? {},
    error: claim.last_error ?? null,
    syncedAt: claim.synced_at ?? null,
  };
}

async function searchClaims(accessToken: string) {
  const queries = [
    new URLSearchParams({ limit: "50" }),
    new URLSearchParams({ limit: "50", status: "opened" }),
    new URLSearchParams({ limit: "50", status: "closed" }),
  ];

  const results = await Promise.all(
    queries.map((params) =>
      postPurchaseApiGet<{ data?: any[] }>(accessToken, `/post-purchase/v1/claims/search?${params.toString()}`).catch((error) => {
        console.warn("Falha ao buscar reclamações Mercado Livre", {
          params: params.toString(),
          error: friendlyError(error, "Falha ao buscar reclamações."),
        });
        return { data: [] };
      }),
    ),
  );

  const byId = new Map<string, any>();
  for (const result of results) {
    for (const claim of Array.isArray(result.data) ? result.data : []) {
      const claimId = String(claim?.id ?? "").trim();
      if (claimId) byId.set(claimId, { ...byId.get(claimId), ...claim });
    }
  }

  return Array.from(byId.values());
}

function getClaimResolution(detail: any) {
  const resolution = detail?.resolution ?? detail?.resolved_by ?? detail?.expected_resolution ?? null;
  if (!resolution) return null;
  if (typeof resolution === "string") return resolution;
  return (
    resolution?.type ??
    resolution?.status ??
    resolution?.decision ??
    resolution?.expected_resolution ??
    resolution?.reason ??
    null
  );
}

function getClaimAvailableActions(detail: any) {
  if (Array.isArray(detail?.available_actions)) return detail.available_actions;
  if (Array.isArray(detail?.actions)) return detail.actions;
  if (Array.isArray(detail?.available_resolutions)) return detail.available_resolutions;
  return (detail?.players ?? [])
    .filter((player: any) => player?.type === "seller" || player?.role === "respondent")
    .flatMap((player: any) => (Array.isArray(player?.available_actions) ? player.available_actions : []));
}

function getSellerAvailableActionNames(claim: any, sellerId: number) {
  return (claim?.players ?? [])
    .filter((player: any) => Number(player?.user_id) === sellerId || player?.type === "seller" || player?.role === "respondent")
    .flatMap((player: any) => (Array.isArray(player?.available_actions) ? player.available_actions : []))
    .map((item: any) => String(item?.action ?? item?.type ?? item?.name ?? item).toLowerCase())
    .filter(Boolean);
}

function dedupeClaimCandidates(candidates: Array<{ source: string; claim?: any; notification?: MercadoLivreNotificationRow; claimId: string }>) {
  const byId = new Map<string, { source: string; claim?: any; notification?: MercadoLivreNotificationRow; claimId: string }>();
  for (const candidate of candidates) {
    const claimId = String(candidate.claimId || "").trim();
    if (!claimId) continue;
    byId.set(claimId, { ...byId.get(claimId), ...candidate, claimId });
  }
  return Array.from(byId.values());
}

async function postPurchaseApiGet<T>(accessToken: string, path: string) {
  const response = await fetch(`${POST_PURCHASE_API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mercado Livre ${path} falhou (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

async function postPurchaseApiPost<T>(accessToken: string, path: string) {
  const response = await fetch(`${POST_PURCHASE_API_BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Mercado Livre ${path} falhou (${response.status}): ${text}`);
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { message: text } as T;
  }
}

function friendlyError(error: any, fallback: string) {
  const raw = String(error?.message ?? "");
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) return raw || fallback;

  try {
    const parsed = JSON.parse(raw.slice(jsonStart));
    return parsed.message || parsed.error || fallback;
  } catch {
    return raw || fallback;
  }
}

