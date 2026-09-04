import { NextResponse, type NextRequest } from "next/server";
import { requireAuthenticated, requireVendasAccess, requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { getMercadoLivreOrder, mercadoLivreTokenMetadata, refreshMercadoLivreToken, tokenExpiresAt } from "@/lib/integrations/mercadolivre";
import { importMercadoLivreOrder } from "@/lib/integrations/mercadolivre-orders";
import { normalizeMercadoLivreReturn } from "@/lib/integrations/mercadolivre-return";
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
  returnData: any;
  partialRefundOffers: any[];
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
    const orders = await getOrders(account.empresa_id, account.id, orderDbId, mlOrderId);
    const notifications = await getClaimNotifications(account);
    const searchedClaims = await searchClaims(accessToken, account.ml_user_id);
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

          const mergedDetail = { ...candidate.claim, ...detail };
          const [returnData, partialRefundOffers] = await Promise.all([
            getClaimReturn(accessToken, claimId),
            hasClaimAction(mergedDetail, "allow_partial_refund") ? getPartialRefundOffers(accessToken, claimId) : Promise.resolve([]),
          ]);
          return normalizeClaim(
            claimId,
            mergedDetail,
            candidate.notification?.resource ?? candidate.claim?.resource ?? null,
            order,
            returnData,
            partialRefundOffers,
          );
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
    const storedClaims = await getStoredClaims(account.empresa_id, account.id, orderDbId, mlOrderId);

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

    if (action === "process_return_inventory") {
      const produtoId = Number(body?.produtoId);
      const quantity = Math.trunc(Number(body?.quantity));
      const disposition = String(body?.disposition ?? "").trim().toUpperCase();
      const note = String(body?.note ?? "").trim();
      const requestKey = String(body?.requestKey ?? "").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) {
        return NextResponse.json({ error: "Identificador da conferência inválido. Tente novamente." }, { status: 400 });
      }
      if (!Number.isInteger(produtoId) || produtoId <= 0) {
        return NextResponse.json({ error: "Selecione o produto devolvido." }, { status: 400 });
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return NextResponse.json({ error: "Informe uma quantidade devolvida válida." }, { status: 400 });
      }
      if (!["RESTOCK", "DAMAGED", "NOT_RETURNED"].includes(disposition)) {
        return NextResponse.json({ error: "Selecione a destinação do produto devolvido." }, { status: 400 });
      }
      if (disposition !== "RESTOCK" && note.length < 3) {
        return NextResponse.json({ error: "Informe uma observação sobre o produto que não voltou ao estoque." }, { status: 400 });
      }
      const session = await requireAuthenticated();
      const { data, error } = await supabaseAdmin.rpc("processar_devolucao_mercadolivre_estoque", {
        p_empresa_id: empresaId,
        p_request_key: requestKey,
        p_ml_claim_id: claimId,
        p_produto_id: produtoId,
        p_disposition: disposition,
        p_quantity: quantity,
        p_note: note || null,
        p_processed_by: (session.user as any)?.id ?? null,
      });
      if (error) throw error;
      return NextResponse.json({ ok: true, data });
    }

    const actionConfig: Record<string, { availableNames: string[]; path: string }> = {
      refund: { availableNames: ["refund", "allow_refund"], path: "expected-resolutions/refund" },
      allow_return: { availableNames: ["allow_return", "return_product"], path: "expected-resolutions/allow-return" },
      partial_refund: { availableNames: ["allow_partial_refund", "partial_refund"], path: "expected-resolutions/partial-refund" },
      return_review_ok: { availableNames: ["return_review_ok"], path: "return-review" },
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

    let result: any;
    if (action === "return_review_ok") {
      const returnData = await getClaimReturn(accessToken, claimId);
      const returnId = String(returnData?.id ?? "").trim();
      if (!returnId) return NextResponse.json({ error: "A devolução ainda não possui um identificador para conferência." }, { status: 409 });
      result = await postPurchaseApiPost<any>(accessToken, `/post-purchase/v1/returns/${encodeURIComponent(returnId)}/return-review`, {});
    } else if (action === "partial_refund") {
      const percentage = Number(body?.percentage);
      const offers = await getPartialRefundOffers(accessToken, claimId);
      if (!Number.isFinite(percentage) || percentage >= 100 || !offers.some((offer: any) => Number(offer?.percentage) === percentage)) {
        return NextResponse.json({ error: "Selecione um percentual de reembolso parcial oferecido pelo Mercado Livre." }, { status: 400 });
      }
      result = await postPurchaseApiPost<any>(
        accessToken,
        `/post-purchase/v1/claims/${encodeURIComponent(claimId)}/${config.path}`,
        { percentage },
      );
    } else {
      result = await postPurchaseApiPost<any>(accessToken, `/post-purchase/v1/claims/${encodeURIComponent(claimId)}/${config.path}`, {});
    }
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
      raw_token: mercadoLivreTokenMetadata(token),
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);

  if (error) throw error;
  return token.access_token;
}

async function getOrders(empresaId: number, accountId: number, orderDbId: number, mlOrderId: number) {
  let query = supabaseAdmin
    .from("mercadolivre_order")
    .select("id, empresa_id, ml_order_id, ml_shipment_id")
    .eq("empresa_id", empresaId)
    .eq("account_id", accountId)
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

function normalizeClaim(
  claimId: string,
  detail: any,
  resource: string | null,
  order: MercadoLivreOrderRow,
  returnData: any,
  partialRefundOffers: any[],
): NormalizedClaim {
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
    returnData: returnData ?? {},
    partialRefundOffers,
    error: null,
  };
}

async function persistClaims(account: MercadoLivreAccount, claims: NormalizedClaim[]) {
  const nowIso = new Date().toISOString();
  const rows = claims.map((claim) => {
    const returnSummary = normalizeMercadoLivreReturn(claim.returnData);
    return {
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
      return_id: returnSummary.id,
      return_status: returnSummary.status,
      return_tracking_number: returnSummary.trackingNumber,
      return_shipment_id: returnSummary.shipmentId,
      raw_return: claim.returnData ?? {},
      partial_refund_offers: claim.partialRefundOffers,
      return_updated_at: Object.keys(claim.returnData ?? {}).length > 0 ? nowIso : null,
      last_error: claim.error,
      synced_at: nowIso,
      updated_at: nowIso,
    };
  });

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

async function getStoredClaims(empresaId: number, accountId: number, orderDbId: number, mlOrderId: number) {
  let query = supabaseAdmin
    .from("mercadolivre_claim")
    .select("id, order_id, ml_order_id, ml_shipment_id, ml_claim_id, status, stage, claim_type, reason, title, due_date, closed_at, resolution, available_actions, players, resource, raw_claim, return_id, return_status, return_tracking_number, return_shipment_id, raw_return, partial_refund_offers, return_updated_at, last_error, synced_at")
    .eq("empresa_id", empresaId)
    .eq("account_id", accountId)
    .order("synced_at", { ascending: false })
    .limit(100);

  if (Number.isFinite(orderDbId) && orderDbId > 0) query = query.eq("order_id", orderDbId);
  if (Number.isFinite(mlOrderId) && mlOrderId > 0) query = query.eq("ml_order_id", mlOrderId);

  const { data, error } = await query;
  if (error) throw error;
  const claims = data ?? [];
  if (!claims.length) return claims;

  const orderIds = Array.from(new Set(claims.map((claim: any) => Number(claim.order_id)).filter((id) => Number.isInteger(id) && id > 0)));
  const claimIds = claims.map((claim: any) => Number(claim.id)).filter((id) => Number.isInteger(id) && id > 0);
  const ordersPromise = orderIds.length
    ? supabaseAdmin.from("mercadolivre_order").select("id, venda_id").eq("empresa_id", empresaId).in("id", orderIds)
    : Promise.resolve({ data: [], error: null });
  const [{ data: orders, error: ordersError }, { data: decisions, error: decisionsError }] = await Promise.all([
    ordersPromise,
    supabaseAdmin
      .from("mercadolivre_return_inventory")
      .select("id, claim_id, produto_id, disposition, quantity, restored_quantity, stock_before, stock_after, note, processed_at")
      .eq("empresa_id", empresaId)
      .in("claim_id", claimIds),
  ]);
  if (ordersError) throw ordersError;
  if (decisionsError) throw decisionsError;

  const vendaByOrder = new Map((orders ?? []).map((order: any) => [Number(order.id), Number(order.venda_id)]));
  const vendaIds = Array.from(new Set(Array.from(vendaByOrder.values()).filter((id) => Number.isInteger(id) && id > 0)));
  const [{ data: saleItems, error: saleItemsError }, { data: deductions, error: deductionsError }] = vendaIds.length
    ? await Promise.all([
        supabaseAdmin
          .from("vendaproduto")
          .select("venda_id, produtoid, quantidade, produto:produtoid(id, titulo, referencia, unidade, estoque)")
          .in("venda_id", vendaIds),
        supabaseAdmin.from("vendaproduto_baixa").select("venda_id, produtoid, quantidade").in("venda_id", vendaIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (saleItemsError) throw saleItemsError;
  if (deductionsError) throw deductionsError;

  const deductionBySaleProduct = new Map(
    (deductions ?? []).map((entry: any) => [`${entry.venda_id}:${entry.produtoid}`, Number(entry.quantidade ?? 0)]),
  );
  const itemsBySaleProduct = new Map<string, any>();
  for (const entry of saleItems ?? []) {
    const vendaId = Number((entry as any).venda_id);
    const produtoId = Number((entry as any).produtoid);
    const product = Array.isArray((entry as any).produto) ? (entry as any).produto[0] : (entry as any).produto;
    const key = `${vendaId}:${produtoId}`;
    const current = itemsBySaleProduct.get(key);
    itemsBySaleProduct.set(key, {
      produtoId,
      title: product?.titulo ?? `Produto #${(entry as any).produtoid}`,
      reference: product?.referencia ?? null,
      unit: product?.unidade ?? null,
      soldQuantity: Number(current?.soldQuantity ?? 0) + Number((entry as any).quantidade ?? 0),
      deductedQuantity: deductionBySaleProduct.get(key) ?? 0,
      currentStock: Number(product?.estoque ?? 0),
    });
  }
  const itemsBySale = new Map<number, any[]>();
  for (const [key, item] of itemsBySaleProduct.entries()) {
    const vendaId = Number(key.split(":", 1)[0]);
    itemsBySale.set(vendaId, [...(itemsBySale.get(vendaId) ?? []), item]);
  }
  const decisionsByClaim = new Map<number, any[]>();
  for (const decision of decisions ?? []) {
    const key = Number((decision as any).claim_id);
    decisionsByClaim.set(key, [...(decisionsByClaim.get(key) ?? []), decision]);
  }

  return claims.map((claim: any) => {
    const vendaId = vendaByOrder.get(Number(claim.order_id));
    return {
      ...claim,
      inventory_items: vendaId ? itemsBySale.get(vendaId) ?? [] : [],
      inventory_decisions: decisionsByClaim.get(Number(claim.id)) ?? [],
    };
  });
}

function normalizeStoredClaim(claim: any) {
  const returnSummary = normalizeMercadoLivreReturn(claim.raw_return);
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
    returnData: claim.raw_return ?? {},
    returnId: claim.return_id ?? returnSummary.id,
    returnStatus: claim.return_status ?? returnSummary.status,
    returnTrackingNumber: claim.return_tracking_number ?? returnSummary.trackingNumber,
    returnShipmentId: claim.return_shipment_id ?? returnSummary.shipmentId,
    returnShipmentStatus: returnSummary.shipmentStatus,
    returnDestinationName: returnSummary.destinationName,
    returnDestinationAddress: returnSummary.destinationAddress,
    returnQuantity: returnSummary.returnQuantity,
    returnTotalQuantity: returnSummary.totalQuantity,
    partialRefundOffers: Array.isArray(claim.partial_refund_offers) ? claim.partial_refund_offers : [],
    returnUpdatedAt: claim.return_updated_at ?? null,
    inventoryItems: Array.isArray(claim.inventory_items) ? claim.inventory_items : [],
    inventoryDecisions: Array.isArray(claim.inventory_decisions)
      ? claim.inventory_decisions.map((decision: any) => ({
          id: decision.id,
          produtoId: decision.produto_id,
          disposition: decision.disposition,
          quantity: decision.quantity,
          restoredQuantity: decision.restored_quantity,
          stockBefore: decision.stock_before,
          stockAfter: decision.stock_after,
          note: decision.note,
          processedAt: decision.processed_at,
        }))
      : [],
    error: claim.last_error ?? null,
    syncedAt: claim.synced_at ?? null,
  };
}

async function searchClaims(accessToken: string, sellerId: number) {
  const sellerFilter = {
    "players.user_id": String(sellerId),
    "players.role": "respondent",
    limit: "50",
    sort: "last_updated:desc",
  };
  const queries = [
    new URLSearchParams({ ...sellerFilter, status: "opened" }),
    new URLSearchParams({ ...sellerFilter, status: "closed" }),
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
  const playerActions = (claim?.players ?? [])
    .filter((player: any) => Number(player?.user_id) === sellerId || player?.type === "seller" || player?.role === "respondent")
    .flatMap((player: any) => (Array.isArray(player?.available_actions) ? player.available_actions : []))
    .map((item: any) => String(item?.action ?? item?.type ?? item?.name ?? item).toLowerCase())
    .filter(Boolean);
  if (playerActions.length > 0) return playerActions;
  return getClaimAvailableActions(claim)
    .map((item: any) => String(item?.action ?? item?.type ?? item?.name ?? item).toLowerCase())
    .filter(Boolean);
}

function hasClaimAction(claim: any, actionName: string) {
  return getClaimAvailableActions(claim).some((action: any) =>
    [action?.action, action?.type, action?.name, action].map((value) => String(value ?? "").toLowerCase()).includes(actionName),
  );
}

async function getClaimReturn(accessToken: string, claimId: string) {
  try {
    const result = await postPurchaseApiGet<any>(accessToken, `/post-purchase/v2/claims/${encodeURIComponent(claimId)}/returns`);
    if (Array.isArray(result)) return result[0] ?? {};
    if (Array.isArray(result?.data)) return result.data[0] ?? {};
    return result ?? {};
  } catch (error: any) {
    if (String(error?.message ?? "").includes("(404)")) return {};
    console.warn("Falha ao carregar devolução Mercado Livre", { claimId, error: friendlyError(error, "Falha ao carregar devolução.") });
    return {};
  }
}

async function getPartialRefundOffers(accessToken: string, claimId: string) {
  try {
    const result = await postPurchaseApiGet<any>(
      accessToken,
      `/post-purchase/v1/claims/${encodeURIComponent(claimId)}/partial-refund/available-offers`,
    );
    return Array.isArray(result?.available_offers) ? result.available_offers : [];
  } catch (error) {
    console.warn("Falha ao carregar ofertas de reembolso parcial Mercado Livre", { claimId, error });
    return [];
  }
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

async function postPurchaseApiPost<T>(accessToken: string, path: string, body?: unknown) {
  const response = await fetch(`${POST_PURCHASE_API_BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body ?? {}),
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

