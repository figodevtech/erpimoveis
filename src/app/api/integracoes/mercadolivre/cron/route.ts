import { NextResponse, type NextRequest } from "next/server";
import { retryMercadoLivreNotifications } from "@/lib/integrations/mercadolivre-notifications";
import { syncMercadoLivreOrders } from "@/lib/integrations/mercadolivre-orders";
import { syncMercadoLivreListingMetricsHistory, syncMercadoLivreProductLinks, syncRecentMercadoLivreShipments } from "@/lib/integrations/mercadolivre-reconciliation";
import { syncPendingMercadoLivreStock } from "@/lib/integrations/mercadolivre-stock-sync";
import { syncRecentMercadoLivreInvoices } from "@/lib/integrations/mercadolivre-invoice";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JOBS = ["notifications", "orders", "items", "shipments", "stock", "metrics", "invoices"] as const;
type Job = (typeof JOBS)[number];

export async function GET(req: NextRequest) {
  const unauthorized = authorizeCron(req);
  if (unauthorized) return unauthorized;
  const job = req.nextUrl.searchParams.get("job")?.trim().toLowerCase();
  if (!JOBS.includes(job as Job)) return NextResponse.json({ error: "Informe um trabalho válido.", jobs: JOBS }, { status: 400 });

  const startedAt = Date.now();
  const audit = await startSyncRun(req, job as Job);
  if (audit.skipped) return NextResponse.json({ ok: true, skipped: true, job, reason: "Já existe uma execução em andamento." });

  try {
    const result = await executeJob(job as Job);
    const summary = { ok: result.failed === 0, [job!]: result };
    await finishSyncRun(audit.runId, summary, startedAt);
    return NextResponse.json({ ...summary, job, runId: audit.runId, durationMs: Date.now() - startedAt });
  } catch (error: unknown) {
    console.error(`GET /api/integracoes/mercadolivre/cron?job=${job}`, error);
    await failSyncRun(audit.runId, error, startedAt);
    return NextResponse.json({ error: errorMessage(error), job }, { status: 500 });
  }
}

function authorizeCron(req: NextRequest) {
  const secrets = [process.env.CRON_SECRET, process.env.MERCADOLIVRE_CRON_SECRET].map((value) => value?.trim()).filter(Boolean) as string[];
  if (!secrets.length && process.env.NODE_ENV === "production") return NextResponse.json({ error: "CRON_SECRET não configurado." }, { status: 503 });
  const received = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (secrets.length && (!received || !secrets.includes(received))) return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  return null;
}

async function executeJob(job: Job) {
  if (job === "notifications") return summarize(await retryMercadoLivreNotifications(30));
  if (job === "orders") {
    const rows = await syncMercadoLivreOrders({ days: 2, limit: 50 });
    return { ...summarize(rows), created: rows.filter((item) => item.created).length };
  }
  if (job === "items") return summarize(await syncMercadoLivreProductLinks(), "sync_error");
  if (job === "shipments") return summarize(await syncRecentMercadoLivreShipments(15));
  if (job === "stock") return summarize(await syncPendingMercadoLivreStock({ limit: 50 }));
  if (job === "metrics") return summarize(await syncMercadoLivreListingMetricsHistory({ days: 60, limit: 10 }));
  return summarize(await syncRecentMercadoLivreInvoices(15));
}

function summarize(items: any[], errorField = "error") {
  return { total: items.length, success: items.filter((item) => !item?.[errorField] && item?.ok !== false).length, failed: items.filter((item) => Boolean(item?.[errorField]) || item?.ok === false).length };
}

async function startSyncRun(req: NextRequest, job: Job) {
  const jobName = job.toUpperCase();
  const staleBefore = new Date(Date.now() - 12 * 60_000).toISOString();
  const { error: staleError } = await supabaseAdmin.from("mercadolivre_sync_run").update({ status: "ERRO", error: "Execução interrompida antes da conclusão.", completed_at: new Date().toISOString() }).eq("job_name", jobName).eq("status", "PROCESSANDO").lt("started_at", staleBefore);
  if (staleError) console.warn("Não foi possível encerrar auditoria antiga do cron Mercado Livre", staleError);

  const { data: active, error: activeError } = await supabaseAdmin.from("mercadolivre_sync_run").select("id").eq("job_name", jobName).eq("status", "PROCESSANDO").limit(1).maybeSingle();
  if (activeError) throw activeError;
  if (active) return { runId: null, skipped: true };

  const { data, error } = await supabaseAdmin.from("mercadolivre_sync_run").insert({ job_name: jobName, trigger_source: resolveTriggerSource(req), status: "PROCESSANDO" }).select("id").single();
  if (error?.code === "23505") return { runId: null, skipped: true };
  if (error) throw error;
  return { runId: Number(data.id), skipped: false };
}

function resolveTriggerSource(req: NextRequest) {
  const declared = String(req.headers.get("x-cron-source") ?? "").trim().toUpperCase();
  const agent = String(req.headers.get("user-agent") ?? "").toLowerCase();
  if (declared === "SUPABASE" || agent.includes("supabase") || agent.includes("pg_net")) return "SUPABASE_CRON";
  return req.headers.get("x-vercel-cron") ? "VERCEL_CRON" : "HTTP_CRON";
}

async function finishSyncRun(runId: number | null, summary: Record<string, unknown>, startedAt: number) {
  if (!runId) return;
  const result = Object.values(summary).find((value) => value && typeof value === "object" && "failed" in value) as { failed?: number } | undefined;
  const { error } = await supabaseAdmin.from("mercadolivre_sync_run").update({ status: Number(result?.failed ?? 0) ? "PARCIAL" : "CONCLUIDO", summary, completed_at: new Date().toISOString(), duration_ms: Date.now() - startedAt }).eq("id", runId);
  if (error) throw new Error(`A rotina terminou, mas sua auditoria não foi concluída: ${error.message}`);
}

async function failSyncRun(runId: number | null, failure: unknown, startedAt: number) {
  if (!runId) return;
  const { error } = await supabaseAdmin.from("mercadolivre_sync_run").update({ status: "ERRO", error: errorMessage(failure).slice(0, 4000), completed_at: new Date().toISOString(), duration_ms: Date.now() - startedAt }).eq("id", runId);
  if (error) console.error("Não foi possível registrar falha do cron Mercado Livre", error);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Falha na rotina Mercado Livre.";
}
