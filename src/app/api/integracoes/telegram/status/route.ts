import { NextResponse } from "next/server";
import { requireConfigAccess } from "@/app/api/_authz/perms";
import { getTelegramBot, getTelegramEnvironment, getTelegramWebhookInfo } from "@/lib/integrations/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function countRows(table: string, statusColumn: string, statuses: string[]) {
  const { count } = await supabaseAdmin.from(table).select("id", { head: true, count: "exact" }).in(statusColumn, statuses);
  return count ?? 0;
}

export async function GET() {
  try {
    await requireConfigAccess();
    const environment = getTelegramEnvironment();
    const [{ count: connected }, pendingEvents, pendingDeliveries, failedDeliveries, latestRun] = await Promise.all([
      supabaseAdmin.from("telegram_usuario_preferencia").select("usuario_id", { head: true, count: "exact" }).not("chat_id", "is", null),
      countRows("os_notificacao_evento", "status_processamento", ["PENDENTE", "PROCESSANDO", "ERRO"]),
      countRows("os_notificacao_entrega", "status", ["PENDENTE", "ENVIANDO"]),
      countRows("os_notificacao_entrega", "status", ["ERRO", "DESCARTADO"]),
      supabaseAdmin.from("telegram_processamento_execucao").select("status, resumo, erro, started_at, completed_at").order("id", { ascending: false }).limit(1).maybeSingle(),
    ]);

    let bot = null;
    let webhook = null;
    let connectionError = null;
    if (environment.configured) {
      try {
        const [botData, webhookData] = await Promise.all([getTelegramBot(), getTelegramWebhookInfo()]);
        bot = botData;
        webhook = webhookData;
      } catch (error) {
        connectionError = error instanceof Error ? error.message : "Falha ao consultar o Telegram.";
      }
    }
    return NextResponse.json({
      environment: {
        enabled: environment.enabled,
        configured: environment.configured,
        hasWebhookSecret: Boolean(environment.webhookSecret),
        hasAppUrl: Boolean(environment.appUrl),
        botUsername: environment.botUsername || null,
      },
      bot,
      webhook,
      connectionError,
      metrics: { connected: connected ?? 0, pendingEvents, pendingDeliveries, failedDeliveries },
      latestRun: latestRun.data ?? null,
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
    return NextResponse.json({ error: statusCode === 500 ? "Não foi possível consultar a integração." : "Sem permissão." }, { status: statusCode });
  }
}
