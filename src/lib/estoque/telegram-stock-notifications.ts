import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getTelegramEnvironment,
  sendTelegramMessage,
  TelegramApiError,
} from "@/lib/integrations/telegram";
import { buildStockMovementMessage, type TelegramStockMovement } from "@/lib/estoque/telegram-stock-notification-format";
import { isStockNotificationEvent, type StockNotificationEvent } from "@/lib/estoque/telegram-stock-events";

const RETRY_MINUTES = [1, 5, 15, 60, 180];

type StockDelivery = {
  id: number;
  movimento_id: number;
  usuario_id: string;
  chat_id: number;
  evento_tipo: StockNotificationEvent;
  tentativas: number;
};

const MOVEMENT_SELECT = `
  id, produto_id, quantidade, saldo_anterior, saldo_resultante,
  entrada_id, saida_id, venda_id, ordemservicoid,
  documento_label, observacao, created_at,
  produto_titulo, produto_referencia, produto_unidade,
  entrada_origem, entrada_fiscal, entrada_numero_nota, fornecedor_nome,
  saida_motivo, saida_observacao, criador_nome
`;

async function loadMovement(delivery: StockDelivery) {
  if (!isStockNotificationEvent(delivery.evento_tipo)) {
    throw new Error(`Evento de estoque inválido: ${delivery.evento_tipo}.`);
  }
  const { data, error } = await supabaseAdmin
    .from("estoque_movimento_historico")
    .select(MOVEMENT_SELECT)
    .eq("id", delivery.movimento_id)
    .single();
  if (error) throw error;
  return data as unknown as TelegramStockMovement;
}

async function completeDelivery(delivery: StockDelivery, telegramMessageId: number) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("telegram_estoque_entrega")
    .update({
      status: "ENVIADO",
      telegram_message_id: telegramMessageId,
      sent_at: now,
      locked_at: null,
      updated_at: now,
    })
    .eq("id", delivery.id);
  if (error) throw error;
}

async function failDelivery(delivery: StockDelivery, failure: unknown) {
  const apiError = failure instanceof TelegramApiError ? failure : null;
  const permanent = apiError?.isPermanent ?? false;
  const exhausted = delivery.tentativas >= 5;
  const retryMinutes = RETRY_MINUTES[Math.min(Math.max(delivery.tentativas - 1, 0), RETRY_MINUTES.length - 1)];
  const retryMs = (apiError?.retryAfterSeconds ?? retryMinutes * 60) * 1000;
  const now = new Date().toISOString();
  const message = String(failure instanceof Error ? failure.message : failure).slice(0, 1000);
  await supabaseAdmin
    .from("telegram_estoque_entrega")
    .update({
      status: permanent || exhausted ? "DESCARTADO" : "ERRO",
      next_retry_at: permanent || exhausted ? null : new Date(Date.now() + retryMs).toISOString(),
      locked_at: null,
      erro_codigo: apiError ? String(apiError.errorCode) : "INTERNAL",
      erro_mensagem: message,
      updated_at: now,
    })
    .eq("id", delivery.id);

  if (permanent && [400, 403].includes(apiError?.errorCode ?? 0)) {
    await supabaseAdmin
      .from("telegram_usuario_preferencia")
      .update({ ultimo_erro: message, updated_at: now })
      .eq("usuario_id", delivery.usuario_id);
  }
}

export async function processTelegramStockNotifications(params: { deliveryLimit?: number } = {}) {
  const environment = getTelegramEnvironment();
  if (!environment.enabled) {
    return { skipped: true, processedDeliveries: 0, sent: 0, failed: 0 };
  }
  if (!environment.configured) throw new Error("Telegram não está configurado por completo.");

  const { data, error } = await supabaseAdmin.rpc("fn_reservar_entregas_notificacao_estoque", {
    p_limit: params.deliveryLimit ?? 50,
  });
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  for (const delivery of (data ?? []) as StockDelivery[]) {
    try {
      const movement = await loadMovement(delivery);
      const message = await sendTelegramMessage({
        chatId: delivery.chat_id,
        text: buildStockMovementMessage(delivery.evento_tipo, movement),
        buttonUrl: environment.appUrl ? `${environment.appUrl}/estoque/historico` : undefined,
        buttonLabel: "Abrir histórico",
      });
      await completeDelivery(delivery, message.message_id);
      sent += 1;
    } catch (failure) {
      await failDelivery(delivery, failure);
      failed += 1;
    }
  }

  return {
    skipped: false,
    processedDeliveries: data?.length ?? 0,
    sent,
    failed,
  };
}

