import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  escapeTelegramHtml,
  getTelegramEnvironment,
  sendTelegramMessage,
  TelegramApiError,
} from "@/lib/integrations/telegram";

const RETRY_MINUTES = [1, 5, 15, 60, 180];

type MarketplaceNotification = {
  notification_id: number;
  usuario_id: string;
  chat_id: number;
  title: string;
  message: string;
  href: string | null;
  source_event_id: string;
  attempts: number;
};

export async function processTelegramMarketplaceNotifications(params: {
  sourceEventId?: string;
  limit?: number;
} = {}) {
  const environment = getTelegramEnvironment();
  if (!environment.enabled) return { skipped: true, processedDeliveries: 0, sent: 0, failed: 0 };
  if (!environment.configured) throw new Error("Telegram não está configurado por completo.");

  const { data, error } = await supabaseAdmin.rpc("fn_reservar_notificacoes_marketplace_telegram", {
    p_limit: Math.min(Math.max(params.limit ?? 50, 1), 100),
    p_source_event_id: params.sourceEventId ?? null,
  });
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  for (const notification of (data ?? []) as MarketplaceNotification[]) {
    const attempts = Number(notification.attempts ?? 1);
    try {
      const result = await sendTelegramMessage({
        chatId: Number(notification.chat_id),
        text: [
          "🛒 <b>Mercado Livre</b>",
          `<b>${escapeTelegramHtml(notification.title)}</b>`,
          escapeTelegramHtml(notification.message),
        ].join("\n"),
        buttonUrl: environment.appUrl && notification.href
          ? `${environment.appUrl}${notification.href.startsWith("/") ? notification.href : `/${notification.href}`}`
          : undefined,
        buttonLabel: "Abrir no ERP",
      });
      const { error: updateError } = await supabaseAdmin
        .from("system_notification")
        .update({
          telegram_sent_at: new Date().toISOString(),
          telegram_attempts: attempts,
          telegram_next_retry_at: null,
          telegram_locked_at: null,
          telegram_last_error: null,
          telegram_message_id: result.message_id,
        })
        .eq("id", notification.notification_id)
        .is("telegram_sent_at", null);
      if (updateError) throw updateError;
      sent += 1;
    } catch (failure) {
      const apiError = failure instanceof TelegramApiError ? failure : null;
      const permanent = apiError?.isPermanent ?? false;
      const exhausted = attempts >= RETRY_MINUTES.length;
      const retryMinutes = RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)];
      const retrySeconds = apiError?.retryAfterSeconds ?? retryMinutes * 60;
      const message = String(failure instanceof Error ? failure.message : failure).slice(0, 1000);
      await supabaseAdmin
        .from("system_notification")
        .update({
          telegram_attempts: permanent ? RETRY_MINUTES.length : attempts,
          telegram_next_retry_at: permanent || exhausted ? null : new Date(Date.now() + retrySeconds * 1000).toISOString(),
          telegram_locked_at: null,
          telegram_last_error: message,
        })
        .eq("id", notification.notification_id);
      if (permanent && [400, 403].includes(apiError?.errorCode ?? 0)) {
        await supabaseAdmin
          .from("telegram_usuario_preferencia")
          .update({ ultimo_erro: message, updated_at: new Date().toISOString() })
          .eq("usuario_id", notification.usuario_id);
      }
      failed += 1;
    }
  }

  return { skipped: false, processedDeliveries: data?.length ?? 0, sent, failed };
}
