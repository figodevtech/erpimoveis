import { NextResponse } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();

    const { data: accounts, error: accountsError } = await supabaseAdmin
      .from("mercadolivre_account")
      .select("id, empresa_id, ml_user_id, nickname, site_id, scope, expires_at, refresh_token, updated_at")
      .eq("empresa_id", empresaId)
      .order("updated_at", { ascending: false });
    if (accountsError) throw accountsError;

    const accountIds = (accounts ?? []).map((account: any) => Number(account.id));
    const performanceStart = startOfUtcDay(-29);

    const [
      { data: orders, error: ordersError },
      { data: notifications, error: notificationsError },
      { data: dailyMetrics, error: metricsError },
      { data: performanceOrders, error: performanceOrdersError },
      { data: listingTotals, error: listingTotalsError },
      { data: stockQueue, error: stockQueueError },
    ] =
      await Promise.all([
        supabaseAdmin
          .from("mercadolivre_order")
          .select("id, empresa_id, venda_id, ml_order_id, status, status_detail, payment_status, payment_status_detail, order_tags, date_closed, total_amount, currency_id, date_created, ml_shipment_id, shipment_status, shipment_substatus, shipping_mode, logistic_type, tracking_number, tracking_method, shipment_cost, nfe_id, ml_invoice_id, invoice_status, invoice_fiscal_key, invoice_error, invoice_sent_at, invoice_updated_at, raw_invoice, import_status, import_locked_at, import_error, raw_order, raw_payments, raw_shipment, raw_shipment_costs, raw_shipment_items, shipment_updated_at, last_synced_at, created_at")
          .eq("empresa_id", empresaId)
          .order("created_at", { ascending: false })
          .limit(20),
        accountIds.length
          ? supabaseAdmin
              .from("mercadolivre_notification")
              .select("id, topic, resource, ml_user_id, status, error, created_at")
              .in("account_id", accountIds)
              .order("created_at", { ascending: false })
              .limit(20)
          : Promise.resolve({ data: [], error: null }),
        supabaseAdmin
          .from("mercadolivre_listing_metric_daily")
          .select("metric_date, visits, collected_at")
          .eq("empresa_id", empresaId)
          .gte("metric_date", performanceStart.slice(0, 10))
          .order("metric_date", { ascending: true }),
        supabaseAdmin
          .from("mercadolivre_order")
          .select("ml_order_id, status, payment_status, payment_status_detail, order_tags, date_created, total_amount, raw_order")
          .eq("empresa_id", empresaId)
          .gte("date_created", performanceStart)
          .order("date_created", { ascending: true })
          .limit(1000),
        supabaseAdmin
          .from("mercadolivre_product_link")
          .select("visits_total, sold_quantity, metrics_updated_at, metrics_history_updated_at")
          .eq("empresa_id", empresaId),
        supabaseAdmin
          .from("mercadolivre_stock_sync_queue")
          .select("status, last_error, updated_at")
          .eq("empresa_id", empresaId)
          .order("updated_at", { ascending: false })
          .limit(100),
      ]);

    if (ordersError) throw ordersError;
    if (notificationsError) throw notificationsError;
    if (metricsError) throw metricsError;
    if (performanceOrdersError) throw performanceOrdersError;
    if (listingTotalsError) throw listingTotalsError;
    if (stockQueueError) throw stockQueueError;

    return NextResponse.json({
      accounts: (accounts ?? []).map(({ refresh_token, ...account }: any) => ({
        ...account,
        needs_reconnect: !refresh_token,
      })),
      orders: orders ?? [],
      notifications: notifications ?? [],
      performance: buildPerformance(dailyMetrics ?? [], performanceOrders ?? [], listingTotals ?? []),
      stockSync: buildStockSyncSummary(stockQueue ?? []),
    });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/dashboard", e);
    return NextResponse.json({ error: e?.message || "Falha ao carregar marketplace." }, { status: errorStatus(e) });
  }
}

function startOfUtcDay(offsetDays: number) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString();
}

function buildPerformance(metrics: any[], orders: any[], listings: any[]) {
  const dailyMap = new Map<string, { date: string; visits: number; orders: number; units: number; revenue: number }>();
  for (let offset = -29; offset <= 0; offset += 1) {
    const date = startOfUtcDay(offset).slice(0, 10);
    dailyMap.set(date, { date, visits: 0, orders: 0, units: 0, revenue: 0 });
  }

  let collectedAt: string | null = null;
  for (const metric of metrics) {
    const date = String(metric.metric_date ?? "").slice(0, 10);
    const day = dailyMap.get(date);
    if (!day) continue;
    day.visits += Math.max(Number(metric.visits ?? 0), 0);
    if (metric.collected_at && (!collectedAt || String(metric.collected_at) > collectedAt)) collectedAt = String(metric.collected_at);
  }

  for (const order of orders) {
    if (!isValidPerformanceOrder(order)) continue;
    const date = String(order.date_created ?? "").slice(0, 10);
    const day = dailyMap.get(date);
    if (!day) continue;
    day.orders += 1;
    day.units += getOrderUnits(order.raw_order);
    day.revenue += Math.max(Number(order.total_amount ?? 0), 0);
  }

  const daily = Array.from(dailyMap.values());
  const visits = daily.reduce((total, day) => total + day.visits, 0);
  const orderCount = daily.reduce((total, day) => total + day.orders, 0);
  const units = daily.reduce((total, day) => total + day.units, 0);
  const revenue = daily.reduce((total, day) => total + day.revenue, 0);
  const lifetimeVisits = listings.reduce((total, listing) => total + Math.max(Number(listing.visits_total ?? 0), 0), 0);
  const lifetimeSold = listings.reduce((total, listing) => total + Math.max(Number(listing.sold_quantity ?? 0), 0), 0);
  const listingUpdatedAt = listings
    .flatMap((listing) => [listing.metrics_history_updated_at, listing.metrics_updated_at])
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  return {
    periodDays: 30,
    visits,
    orders: orderCount,
    units,
    revenue,
    conversionRate: visits > 0 ? Number(((orderCount / visits) * 100).toFixed(2)) : 0,
    lifetimeVisits,
    lifetimeSold,
    collectedAt: collectedAt ?? listingUpdatedAt,
    daily,
  };
}

function isValidPerformanceOrder(order: any) {
  const values = [order.status, order.payment_status, order.payment_status_detail]
    .map((value) => String(value ?? "").toLowerCase());
  const tags = Array.isArray(order.order_tags) ? order.order_tags.map((tag: unknown) => String(tag).toLowerCase()) : [];
  const paid = values.some((value) => value === "paid" || value === "approved" || value === "accredited");
  return paid && !values.some((value) => value.includes("cancel") || value.includes("refund") || value.includes("charged_back")) &&
    !tags.some((tag: string) => tag.includes("cancel") || tag.includes("refund"));
}

function getOrderUnits(rawOrder: any) {
  const items = Array.isArray(rawOrder?.order_items) ? rawOrder.order_items : [];
  return items.reduce((total: number, item: any) => total + Math.max(Number(item?.quantity ?? 0), 0), 0);
}

function buildStockSyncSummary(queue: any[]) {
  const pending = queue.filter((item) => ["PENDENTE", "PROCESSANDO"].includes(String(item.status ?? "").toUpperCase())).length;
  const failedRows = queue.filter((item) => String(item.status ?? "").toUpperCase() === "ERRO");
  return {
    pending,
    failed: failedRows.length,
    lastError: failedRows[0]?.last_error ?? null,
    updatedAt: queue[0]?.updated_at ?? null,
  };
}
