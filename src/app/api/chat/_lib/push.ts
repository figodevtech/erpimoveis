import { buildChatPushPayload } from "@/lib/chat/push-payload";
import { sendChatPush } from "@/lib/chat/web-push";
import { getPushTarget } from "./repository";

/**
 * Disparo do Web Push de uma mensagem nova. So e chamado depois que a mensagem
 * foi realmente criada: retentativa idempotente, edicao, reacao, leitura e
 * exclusao nunca passam por aqui.
 *
 * Falhas sao registradas e engolidas: a mensagem ja esta persistida e o
 * contador de nao lidas continua sendo a sinalizacao principal do ERP.
 */
export async function dispatchChatMessagePush(messageId: string) {
  try {
    const target = await getPushTarget(messageId);
    if (!target) return;
    // O destinatario confirmou conversa aberta, aba visivel e Realtime ativo.
    if (target.suppressed) return;

    await sendChatPush(
      target.recipientId,
      buildChatPushPayload({
        conversationId: target.conversationId,
        messageId,
        senderName: target.senderName,
        type: target.type,
        content: target.content,
      }),
    );
  } catch (error) {
    console.error("[chat] falha ao despachar push:", (error as Error)?.message);
  }
}
