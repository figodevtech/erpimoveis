import { NextRequest, NextResponse } from "next/server";
import { processTelegramNotificationQueues } from "@/lib/integrations/telegram-notification-processor";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: NextRequest) {
  const expected = String(process.env.CRON_SECRET ?? "").trim();
  if (!expected) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() === expected;
}

async function processRequest(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const startedAt = Date.now();
  const source = request.headers.get("x-vercel-cron") ? "VERCEL_CRON" : request.headers.get("x-cron-source") ?? "HTTP_CRON";
  const { data: run } = await supabaseAdmin
    .from("telegram_processamento_execucao")
    .insert({ origem: String(source).slice(0, 40), status: "PROCESSANDO" })
    .select("id")
    .maybeSingle();
  try {
    const result = await processTelegramNotificationQueues();
    if (run?.id) {
      await supabaseAdmin.from("telegram_processamento_execucao").update({
        status: result.failed > 0 ? "PARCIAL" : "CONCLUIDO",
        resumo: result,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
      }).eq("id", run.id);
    }
    return NextResponse.json({ ok: true, ...result, durationMs: Date.now() - startedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no processador Telegram.";
    console.error("[telegram-processar]", error);
    if (run?.id) {
      await supabaseAdmin.from("telegram_processamento_execucao").update({
        status: "ERRO",
        erro: message.slice(0, 2000),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
      }).eq("id", run.id);
    }
    return NextResponse.json({ error: "Falha ao processar notificações." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return processRequest(request);
}

export async function POST(request: NextRequest) {
  return processRequest(request);
}
