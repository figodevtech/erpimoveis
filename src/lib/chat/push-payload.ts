import { createHash } from "node:crypto";

import {
  CHAT_PUSH_PREVIEW_LENGTH,
  chatMessagePreviewLabel,
  type ChatMessageType,
} from "@/lib/chat/contracts";

/**
 * Montagem do conteudo do Web Push, isolada do acesso ao banco para poder ser
 * testada sozinha. Nada aqui pode carregar token, dado administrativo ou o
 * caminho do audio no Storage.
 */

export type ChatPushPayload = {
  type: "chat_message";
  conversationId: string;
  messageId: string;
  url: string;
  title: string;
  body: string;
};

/** O endpoint e a credencial do dispositivo; a unicidade usa o hash dele. */
export function hashPushEndpoint(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("hex");
}

export function chatPushPreview(input: { type: ChatMessageType; content: string }) {
  if (input.type === "VOICE") return "Enviou uma mensagem de voz";
  const normalized = chatMessagePreviewLabel(input)
    // Remove controles e marcas invisiveis antes de encurtar o corpo.
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "Enviou uma mensagem";
  if (normalized.length <= CHAT_PUSH_PREVIEW_LENGTH) return normalized;
  return `${normalized.slice(0, CHAT_PUSH_PREVIEW_LENGTH - 1).trimEnd()}…`;
}

/**
 * O deep link apenas orienta a interface. A API continua conferindo se o
 * usuario participa da conversa antes de devolver qualquer mensagem.
 */
export function chatPushDeepLink(conversationId: string, messageId: string) {
  return `/?chat=${encodeURIComponent(conversationId)}&message=${encodeURIComponent(messageId)}`;
}

export function buildChatPushPayload(input: {
  conversationId: string;
  messageId: string;
  senderName: string;
  type: ChatMessageType;
  content: string;
}): ChatPushPayload {
  return {
    type: "chat_message",
    conversationId: input.conversationId,
    messageId: input.messageId,
    url: chatPushDeepLink(input.conversationId, input.messageId),
    title: input.senderName || "Nova mensagem",
    body: chatPushPreview({ type: input.type, content: input.content }),
  };
}
