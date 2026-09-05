import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getTelegramEnvironment,
  sendTelegramMessage,
  TelegramApiError,
} from "@/lib/integrations/telegram";
import {
  buildFinanceiroNotificationMessage,
  type TelegramFinanceiroTransaction,
} from "@/lib/financeiro/telegram-financeiro-notification-format";
import {
  isFinanceiroNotificationEvent,
  type FinanceiroNotificationEvent,
} from "@/lib/financeiro/telegram-financeiro-events";

const RETRY_MINUTES = [1, 5, 15, 60, 180];

type FinanceiroDelivery = {
  id: number;
  transacao_id: number;
  evento_tipo: FinanceiroNotificationEvent;
  ator_usuario_id: string | null;
  usuario_id: string;
  chat_id: number;
  tentativas: number;
};

const TRANSACAO_SELECT = `
  id, descricao, tipo, valor, data, vencimento_em, pago_em, categoria,
  metodopagamento, pendente, updated_at,
  ordemservicoid, vendaid, entrada_id, usoconsumo_entrada_id, transferencia_id,
  nomepagador, cpfcnpjpagador,
  fornecedor:fornecedor_id(nomerazaosocial, nomefantasia),
  banco:banco_id(titulo),
  transferencia:transferencia_id(
    valor, data,
    origem:banco_origem_id(titulo),
    destino:banco_destino_id(titulo)
  )
`;

async function loadTransaction(delivery: FinanceiroDelivery) {
  const { data, error } = await supabaseAdmin
    .from("transacao")
    .select(TRANSACAO_SELECT)
    .eq("id", delivery.transacao_id)
    .single();
  if (error) throw error;
  return data as unknown as TelegramFinanceiroTransaction;
}

async function loadActorName(delivery: FinanceiroDelivery) {
  if (!delivery.ator_usuario_id) return null;
  const { data } = await supabaseAdmin
    .from("usuario")
    .select("nome")
    .eq("id", delivery.ator_usuario_id)
    .maybeSingle();
  return data?.nome ? String(data.nome) : null;
}

/**
 * Para onde o botão leva.
 *
 * A tela de fluxo de caixa abre na aba do próprio fato: quem recebe o aviso de
 * uma conta a pagar cai em "A Pagar", e não no extrato geral.
 */
function deliveryLink(event: FinanceiroNotificationEvent, appUrl: string) {
  if (!appUrl) return { buttonUrl: undefined, buttonLabel: undefined };
  if (event === "CONTA_PAGAR_CRIADA") {
    return { buttonUrl: `${appUrl}/fluxodecaixa?view=A_PAGAR`, buttonLabel: "Abrir contas a pagar" };
  }
  if (event === "CONTA_RECEBER_CRIADA") {
    return { buttonUrl: `${appUrl}/fluxodecaixa?view=A_RECEBER`, buttonLabel: "Abrir contas a receber" };
  }
  if (event === "BAIXA_ESTORNADA") {
    return { buttonUrl: `${appUrl}/fluxodecaixa`, buttonLabel: "Abrir fluxo de caixa" };
  }
  return { buttonUrl: `${appUrl}/fluxodecaixa?view=LIQUIDADAS`, buttonLabel: "Abrir liquidadas" };
}

async function completeDelivery(delivery: FinanceiroDelivery, telegramMessageId: number) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("telegram_financeiro_entrega")
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

async function failDelivery(delivery: FinanceiroDelivery, failure: unknown) {
  const apiError = failure instanceof TelegramApiError ? failure : null;
  const permanent = apiError?.isPermanent ?? false;
  const exhausted = delivery.tentativas >= 5;
  const retryMinutes = RETRY_MINUTES[Math.min(Math.max(delivery.tentativas - 1, 0), RETRY_MINUTES.length - 1)];
  const retryMs = (apiError?.retryAfterSeconds ?? retryMinutes * 60) * 1000;
  const now = new Date().toISOString();
  const message = String(failure instanceof Error ? failure.message : failure).slice(0, 1000);
  await supabaseAdmin
    .from("telegram_financeiro_entrega")
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

export async function processTelegramFinanceiroNotifications(params: { deliveryLimit?: number } = {}) {
  const environment = getTelegramEnvironment();
  if (!environment.enabled) {
    return { skipped: true, processedDeliveries: 0, sent: 0, failed: 0 };
  }
  if (!environment.configured) throw new Error("Telegram não está configurado por completo.");

  const { data, error } = await supabaseAdmin.rpc("fn_reservar_entregas_notificacao_financeiro", {
    p_limit: params.deliveryLimit ?? 50,
  });
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  for (const delivery of (data ?? []) as FinanceiroDelivery[]) {
    try {
      if (!isFinanceiroNotificationEvent(delivery.evento_tipo)) {
        throw new Error(`Evento financeiro inválido: ${delivery.evento_tipo}.`);
      }
      const [transaction, actorName] = await Promise.all([
        loadTransaction(delivery),
        loadActorName(delivery),
      ]);
      const message = await sendTelegramMessage({
        chatId: delivery.chat_id,
        text: buildFinanceiroNotificationMessage(delivery.evento_tipo, transaction, actorName),
        ...deliveryLink(delivery.evento_tipo, environment.appUrl),
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
