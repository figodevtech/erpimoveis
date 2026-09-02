import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getTelegramEnvironment,
  sendTelegramMessage,
  TelegramApiError,
} from "@/lib/integrations/telegram";
import {
  buildFiscalNotificationMessage,
  type TelegramFiscalDfe,
  type TelegramFiscalDocument,
  type TelegramFiscalNfe,
  type TelegramFiscalNfse,
} from "@/lib/fiscal/telegram-fiscal-notification-format";
import {
  isFiscalNotificationEvent,
  type FiscalDocumentType,
  type FiscalNotificationEvent,
} from "@/lib/fiscal/telegram-fiscal-events";

const RETRY_MINUTES = [1, 5, 15, 60, 180];

type FiscalDelivery = {
  id: number;
  documento_tipo: FiscalDocumentType;
  documento_id: number;
  evento_tipo: FiscalNotificationEvent;
  usuario_id: string;
  chat_id: number;
  tentativas: number;
};

const NFE_SELECT = `
  id, modelo, serie, numero, chave_acesso, status, protocolo, total_nfe,
  codigo_rejeicao, motivo_rejeicao, justificativacancelamento, dataemissao,
  ordemservicoid, vendaid, destinatario_snapshot,
  cliente:clienteid(nomerazaosocial)
`;

const NFSE_SELECT = `
  id, numero, referencia, status, protocolo, valor_total, erros,
  ordemservicoid, updatedat,
  cliente:clienteid(nomerazaosocial)
`;

const DFE_SELECT = `
  id, nsu, chave_acesso, tipo_documento, emitente_nome, emitente_cnpj,
  valor_total, data_emissao, status, status_manifestacao
`;

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

/**
 * Nome do destinatário da NF-e. A nota avulsa não tem cliente cadastrado: o
 * nome vive no snapshot gravado quando o rascunho nasceu.
 */
function nfeRecipientName(row: Record<string, unknown>) {
  const cliente = relationOne(row.cliente as { nomerazaosocial?: string } | Array<{ nomerazaosocial?: string }> | null);
  if (cliente?.nomerazaosocial) return String(cliente.nomerazaosocial);
  const snapshot = (row.destinatario_snapshot ?? null) as Record<string, unknown> | null;
  const nome = snapshot?.nomerazaosocial ?? snapshot?.razao_social ?? snapshot?.nome ?? snapshot?.xNome;
  return nome ? String(nome) : null;
}

async function loadDocument(delivery: FiscalDelivery): Promise<TelegramFiscalDocument> {
  if (delivery.documento_tipo === "NFE") {
    const { data, error } = await supabaseAdmin
      .from("nfe")
      .select(NFE_SELECT)
      .eq("id", delivery.documento_id)
      .single();
    if (error) throw error;
    const row = data as unknown as Record<string, unknown>;
    return {
      tipo: "NFE",
      documento: { ...(row as unknown as TelegramFiscalNfe), cliente_nome: nfeRecipientName(row) },
    };
  }

  if (delivery.documento_tipo === "NFSE") {
    const { data, error } = await supabaseAdmin
      .from("nfse")
      .select(NFSE_SELECT)
      .eq("id", delivery.documento_id)
      .single();
    if (error) throw error;
    const row = data as unknown as Record<string, unknown>;
    const cliente = relationOne(row.cliente as { nomerazaosocial?: string } | Array<{ nomerazaosocial?: string }> | null);
    return {
      tipo: "NFSE",
      documento: {
        ...(row as unknown as TelegramFiscalNfse),
        cliente_nome: cliente?.nomerazaosocial ? String(cliente.nomerazaosocial) : null,
      },
    };
  }

  const { data, error } = await supabaseAdmin
    .from("fiscal_dfe_documento")
    .select(DFE_SELECT)
    .eq("id", delivery.documento_id)
    .single();
  if (error) throw error;
  return { tipo: "DFE", documento: data as unknown as TelegramFiscalDfe };
}

function deliveryLink(delivery: FiscalDelivery, appUrl: string) {
  if (!appUrl) return { buttonUrl: undefined, buttonLabel: undefined };
  return delivery.documento_tipo === "DFE"
    ? { buttonUrl: `${appUrl}/fiscal`, buttonLabel: "Abrir notas recebidas" }
    : { buttonUrl: `${appUrl}/fiscal`, buttonLabel: "Abrir notas emitidas" };
}

async function completeDelivery(delivery: FiscalDelivery, telegramMessageId: number) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("telegram_fiscal_entrega")
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

async function failDelivery(delivery: FiscalDelivery, failure: unknown) {
  const apiError = failure instanceof TelegramApiError ? failure : null;
  const permanent = apiError?.isPermanent ?? false;
  const exhausted = delivery.tentativas >= 5;
  const retryMinutes = RETRY_MINUTES[Math.min(Math.max(delivery.tentativas - 1, 0), RETRY_MINUTES.length - 1)];
  const retryMs = (apiError?.retryAfterSeconds ?? retryMinutes * 60) * 1000;
  const now = new Date().toISOString();
  const message = String(failure instanceof Error ? failure.message : failure).slice(0, 1000);
  await supabaseAdmin
    .from("telegram_fiscal_entrega")
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

export async function processTelegramFiscalNotifications(params: { deliveryLimit?: number } = {}) {
  const environment = getTelegramEnvironment();
  if (!environment.enabled) {
    return { skipped: true, processedDeliveries: 0, sent: 0, failed: 0 };
  }
  if (!environment.configured) throw new Error("Telegram não está configurado por completo.");

  const { data, error } = await supabaseAdmin.rpc("fn_reservar_entregas_notificacao_fiscal", {
    p_limit: params.deliveryLimit ?? 50,
  });
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  for (const delivery of (data ?? []) as FiscalDelivery[]) {
    try {
      if (!isFiscalNotificationEvent(delivery.evento_tipo)) {
        throw new Error(`Evento fiscal inválido: ${delivery.evento_tipo}.`);
      }
      const document = await loadDocument(delivery);
      const message = await sendTelegramMessage({
        chatId: delivery.chat_id,
        text: buildFiscalNotificationMessage(delivery.evento_tipo, document),
        ...deliveryLink(delivery, environment.appUrl),
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
