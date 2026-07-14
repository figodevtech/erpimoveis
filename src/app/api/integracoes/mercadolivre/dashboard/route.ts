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

    const accountUserIds = (accounts ?? []).map((account: any) => Number(account.ml_user_id));
    const performanceStart = startOfUtcDay(-29);

    const [
      { data: orders, error: ordersError },
      { data: notifications, error: notificationsError },
      { data: dailyMetrics, error: metricsError },
      { data: performanceOrders, error: performanceOrdersError },
      { data: listingTotals, error: listingTotalsError },
      { data: stockQueue, error: stockQueueError },
      { data: syncRuns, error: syncRunsError },
      { data: operationalOrders, error: operationalOrdersError },
    ] =
      await Promise.all([
        supabaseAdmin
          .from("mercadolivre_order")
          .select("id, empresa_id, venda_id, ml_order_id, status, status_detail, payment_status, payment_status_detail, order_tags, date_closed, cancel_group, cancel_code, cancel_description, cancel_requested_by, cancel_date, feedback_sale, total_amount, currency_id, date_created, ml_shipment_id, shipment_status, shipment_substatus, shipping_mode, logistic_type, tracking_number, tracking_method, shipment_cost, shipment_label_ready, shipment_label_error, shipment_label_checked_at, shipment_handling_deadline, shipment_estimated_delivery_from, shipment_estimated_delivery_to, shipment_last_event_at, nfe_id, ml_invoice_id, invoice_status, invoice_fiscal_key, invoice_error, invoice_sent_at, invoice_updated_at, raw_invoice, import_status, import_locked_at, import_error, raw_order, raw_payments, raw_shipment, raw_shipment_costs, raw_shipment_items, shipment_updated_at, last_synced_at, created_at")
          .eq("empresa_id", empresaId)
          .order("created_at", { ascending: false })
          .limit(20),
        accountUserIds.length
          ? supabaseAdmin
              .from("mercadolivre_notification")
              .select("id, topic, resource, ml_user_id, status, error, processing_attempts, next_retry_at, locked_at, processed_at, created_at")
              .in("ml_user_id", accountUserIds)
              .order("created_at", { ascending: false })
              .limit(100)
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
        supabaseAdmin
          .from("mercadolivre_sync_run")
          .select("id, job_name, trigger_source, status, summary, error, started_at, completed_at, duration_ms")
          .order("started_at", { ascending: false })
          .limit(20),
        supabaseAdmin
          .from("mercadolivre_order")
          .select("id, import_status, import_error, invoice_status, invoice_error, shipment_label_error, last_synced_at")
          .eq("empresa_id", empresaId)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);

    if (ordersError) throw ordersError;
    if (notificationsError) throw notificationsError;
    if (metricsError) throw metricsError;
    if (performanceOrdersError) throw performanceOrdersError;
    if (listingTotalsError) throw listingTotalsError;
    if (stockQueueError) throw stockQueueError;
    if (syncRunsError) throw syncRunsError;
    if (operationalOrdersError) throw operationalOrdersError;

    const stockSync = buildStockSyncSummary(stockQueue ?? []);
    const diagnostics = buildDiagnostics({
      accounts: accounts ?? [],
      notifications: notifications ?? [],
      stockSync,
      syncRuns: syncRuns ?? [],
      orders: operationalOrders ?? [],
      listings: listingTotals ?? [],
    });

    return NextResponse.json({
      accounts: (accounts ?? []).map(({ refresh_token, ...account }: any) => ({
        ...account,
        needs_reconnect: !refresh_token,
      })),
      orders: orders ?? [],
      notifications: notifications ?? [],
      syncRuns: syncRuns ?? [],
      diagnostics,
      performance: buildPerformance(dailyMetrics ?? [], performanceOrders ?? [], listingTotals ?? []),
      stockSync,
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

function buildDiagnostics(params: {
  accounts: any[];
  notifications: any[];
  stockSync: ReturnType<typeof buildStockSyncSummary>;
  syncRuns: any[];
  orders: any[];
  listings: any[];
}) {
  const now = Date.now();
  const checks: Array<{ id: string; label: string; status: "ok" | "warning" | "error"; message: string; updatedAt?: string | null }> = [];
  const account = params.accounts[0];
  const tokenExpiresAt = account?.expires_at ? new Date(account.expires_at).getTime() : 0;
  checks.push(!account
    ? { id: "account", label: "Conta Mercado Livre", status: "error", message: "Nenhuma conta está conectada." }
    : !account.refresh_token
      ? { id: "account", label: "Conta Mercado Livre", status: "error", message: "A autorização precisa ser renovada.", updatedAt: account.updated_at }
      : tokenExpiresAt > 0 && tokenExpiresAt <= now
        ? { id: "account", label: "Conta Mercado Livre", status: "warning", message: "O access token expirou e será renovado automaticamente na próxima sincronização.", updatedAt: account.updated_at }
      : { id: "account", label: "Conta Mercado Livre", status: "ok", message: `Conta ${account.nickname || account.ml_user_id} conectada.`, updatedAt: account.updated_at });

  const requiredEnvironment = [
    ["MERCADOLIVRE_CLIENT_ID", process.env.MERCADOLIVRE_CLIENT_ID],
    ["MERCADOLIVRE_CLIENT_SECRET", process.env.MERCADOLIVRE_CLIENT_SECRET],
    ["MERCADOLIVRE_REDIRECT_URI", process.env.MERCADOLIVRE_REDIRECT_URI],
    ["MERCADOLIVRE_STATE_SECRET", process.env.MERCADOLIVRE_STATE_SECRET || process.env.AUTH_SECRET],
  ].filter(([, value]) => !String(value ?? "").trim()).map(([name]) => name);
  const cronSecretConfigured = Boolean(String(process.env.CRON_SECRET || process.env.MERCADOLIVRE_CRON_SECRET || "").trim());
  if (!cronSecretConfigured) requiredEnvironment.push("CRON_SECRET");
  checks.push(requiredEnvironment.length
    ? { id: "environment", label: "Configuração do ambiente", status: "error", message: `Variáveis ausentes: ${requiredEnvironment.join(", ")}.` }
    : { id: "environment", label: "Configuração do ambiente", status: "ok", message: "Credenciais OAuth e chave do agendador configuradas." });

  const latestRun = params.syncRuns[0];
  const latestRunAt = latestRun?.completed_at || latestRun?.started_at;
  const runAgeMinutes = latestRunAt ? (now - new Date(latestRunAt).getTime()) / 60_000 : Number.POSITIVE_INFINITY;
  checks.push(!latestRun
    ? { id: "scheduler", label: "Agendador", status: "warning", message: "Nenhuma execução automática foi registrada." }
    : latestRun.status === "PROCESSANDO" && runAgeMinutes > 15
      ? { id: "scheduler", label: "Agendador", status: "error", message: "A última execução está presa em processamento há mais de 15 minutos.", updatedAt: latestRunAt }
    : latestRun.status === "ERRO"
      ? { id: "scheduler", label: "Agendador", status: "error", message: latestRun.error || "A última execução falhou.", updatedAt: latestRunAt }
      : runAgeMinutes > 30
        ? { id: "scheduler", label: "Agendador", status: "warning", message: `Última execução há ${Math.floor(runAgeMinutes)} minutos.`, updatedAt: latestRunAt }
        : { id: "scheduler", label: "Agendador", status: latestRun.status === "PARCIAL" ? "warning" : "ok", message: latestRun.status === "PARCIAL" ? "A última execução terminou com falhas parciais." : "Rotina automática executada recentemente.", updatedAt: latestRunAt });

  const notificationErrors = params.notifications.filter((row) => String(row.status).toUpperCase() === "ERRO");
  const notificationPending = params.notifications.filter((row) => ["RECEBIDA", "PROCESSANDO"].includes(String(row.status).toUpperCase()));
  checks.push(notificationErrors.length
    ? { id: "webhooks", label: "Webhooks", status: "warning", message: `${notificationErrors.length} evento(s) aguardando nova tentativa.`, updatedAt: notificationErrors[0]?.created_at }
    : { id: "webhooks", label: "Webhooks", status: "ok", message: notificationPending.length ? `${notificationPending.length} evento(s) em processamento.` : "Nenhuma falha recente nos eventos.", updatedAt: params.notifications[0]?.created_at });

  checks.push(params.stockSync.failed > 0
    ? { id: "stock", label: "Sincronização de estoque", status: "error", message: `${params.stockSync.failed} produto(s) com falha.`, updatedAt: params.stockSync.updatedAt }
    : { id: "stock", label: "Sincronização de estoque", status: params.stockSync.pending > 20 ? "warning" : "ok", message: params.stockSync.pending ? `${params.stockSync.pending} atualização(ões) na fila.` : "Estoque sem pendências.", updatedAt: params.stockSync.updatedAt });

  const importErrors = params.orders.filter((order) => order.import_error || String(order.import_status).toUpperCase() === "ERRO").length;
  const invoiceErrors = params.orders.filter((order) => order.invoice_error || String(order.invoice_status).toUpperCase() === "ERRO").length;
  checks.push(importErrors || invoiceErrors
    ? { id: "orders", label: "Pedidos e notas fiscais", status: "error", message: `${importErrors} importação(ões) e ${invoiceErrors} nota(s) com falha.` }
    : { id: "orders", label: "Pedidos e notas fiscais", status: "ok", message: "Nenhuma falha operacional recente." });

  const latestMetricsAt = params.listings
    .flatMap((listing) => [listing.metrics_history_updated_at, listing.metrics_updated_at])
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  const metricsStale = Boolean(params.listings.length) && (!latestMetricsAt || now - new Date(latestMetricsAt).getTime() > 36 * 60 * 60 * 1000);
  checks.push(metricsStale
    ? { id: "metrics", label: "Métricas dos anúncios", status: "warning", message: "As métricas não são atualizadas há mais de 36 horas.", updatedAt: latestMetricsAt }
    : { id: "metrics", label: "Métricas dos anúncios", status: "ok", message: params.listings.length ? "Métricas atualizadas." : "Nenhum anúncio vinculado.", updatedAt: latestMetricsAt });

  return {
    status: checks.some((check) => check.status === "error") ? "error" : checks.some((check) => check.status === "warning") ? "warning" : "ok",
    checkedAt: new Date().toISOString(),
    checks,
  };
}
