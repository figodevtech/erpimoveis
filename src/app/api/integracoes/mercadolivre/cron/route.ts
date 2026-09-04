import { NextResponse, type NextRequest } from "next/server";
import { retryMercadoLivreNotifications } from "@/lib/integrations/mercadolivre-notifications";
import { syncMercadoLivreOrders } from "@/lib/integrations/mercadolivre-orders";
import {
  syncMercadoLivreListingMetricsHistory,
  syncMercadoLivreProductLinks,
  syncRecentMercadoLivreShipments,
} from "@/lib/integrations/mercadolivre-reconciliation";
import { syncPendingMercadoLivreStock } from "@/lib/integrations/mercadolivre-stock-sync";
import { syncRecentMercadoLivreInvoices } from "@/lib/integrations/mercadolivre-invoice";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  let runId: number | null = null;
  try {
    const configuredSecrets = [process.env.CRON_SECRET, process.env.MERCADOLIVRE_CRON_SECRET]
      .map((value) => value?.trim())
      .filter(Boolean) as string[];
    if (configuredSecrets.length === 0 && process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "CRON_SECRET não configurado." }, { status: 503 });
    }
    if (configuredSecrets.length > 0) {
      const receivedSecret = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
      if (!receivedSecret || !configuredSecrets.includes(receivedSecret)) {
        return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
      }
    }

    runId = await startSyncRun(req);

    const notifications = await retryMercadoLivreNotifications(30);
    const orders = await syncMercadoLivreOrders({ days: 2, limit: 50 });
    const items = await syncMercadoLivreProductLinks();
    const [shipments, stock, metrics, invoices] = await Promise.all([
      syncRecentMercadoLivreShipments(15),
      syncPendingMercadoLivreStock({ limit: 50 }),
      syncMercadoLivreListingMetricsHistory({ days: 60, limit: 10 }),
      syncRecentMercadoLivreInvoices(15),
    ]);
    const created = orders.filter((item) => item.created).length;

    const summary = {
      ok: true,
      created,
      orders: summarize(orders),
      notifications: summarize(notifications),
      items: summarize(items, "sync_error"),
      shipments: summarize(shipments),
      stock: summarize(stock),
      metrics: summarize(metrics),
      invoices: summarize(invoices),
    };
    await finishSyncRun(runId, summary, startedAt);
    return NextResponse.json({ ...summary, runId, durationMs: Date.now() - startedAt });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/cron", e);
    await failSyncRun(runId, e, startedAt);
    return NextResponse.json({ error: e?.message || "Falha na rotina Mercado Livre." }, { status: 500 });
  }
}

function summarize(items: any[], errorField = "error") {
  return {
    total: items.length,
    success: items.filter((item) => !item?.[errorField] && item?.ok !== false).length,
    failed: items.filter((item) => Boolean(item?.[errorField]) || item?.ok === false).length,
  };
}

async function startSyncRun(req: NextRequest) {
  const declaredSource = String(req.headers.get("x-cron-source") ?? "").trim().toUpperCase();
  const userAgent = String(req.headers.get("user-agent") ?? "").toLowerCase();
  const triggerSource = declaredSource === "SUPABASE" || userAgent.includes("supabase") || userAgent.includes("pg_net")
    ? "SUPABASE_CRON"
    : req.headers.get("x-vercel-cron")
    ? "VERCEL_CRON"
    : "HTTP_CRON";
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  const { error: staleError } = await supabaseAdmin
    .from("mercadolivre_sync_run")
    .update({
      status: "ERRO",
      error: "Execução interrompida antes da conclusão.",
      completed_at: new Date().toISOString(),
    })
    .eq("status", "PROCESSANDO")
    .lt("started_at", staleBefore);
  if (staleError) console.warn("Não foi possível encerrar auditorias antigas do cron Mercado Livre", staleError);

  const { data, error } = await supabaseAdmin
    .from("mercadolivre_sync_run")
    .insert({ job_name: "FULL_SYNC", trigger_source: triggerSource, status: "PROCESSANDO" })
    .select("id")
    .single();
  if (error) {
    console.warn("Não foi possível iniciar auditoria do cron Mercado Livre", error);
    return null;
  }
  return Number(data.id);
}

async function finishSyncRun(runId: number | null, summary: Record<string, unknown>, startedAt: number) {
  if (!runId) return;
  let failed = 0;
  for (const value of Object.values(summary)) {
    if (value && typeof value === "object" && "failed" in value) {
      failed += Number((value as { failed?: number }).failed ?? 0);
    }
  }
  const { error } = await supabaseAdmin
    .from("mercadolivre_sync_run")
    .update({
      status: failed > 0 ? "PARCIAL" : "CONCLUIDO",
      summary,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    })
    .eq("id", runId);
  if (error) console.warn("Não foi possível concluir auditoria do cron Mercado Livre", error);
}

async function failSyncRun(runId: number | null, failure: any, startedAt: number) {
  if (!runId) return;
  const { error } = await supabaseAdmin
    .from("mercadolivre_sync_run")
    .update({
      status: "ERRO",
      error: String(failure?.message || "Falha não identificada.").slice(0, 4000),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    })
    .eq("id", runId);
  if (error) console.warn("Não foi possível registrar falha do cron Mercado Livre", error);
}
