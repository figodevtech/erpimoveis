import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ChatMessage, ChatRealtimeEvent, ConversationSummary } from "@/lib/chat/contracts";
import {
  ChatIncomingMessageToast,
  chatToastPreview,
  isIncomingMessageNotification,
} from "./chat-message-toast";

const currentUserId = "10000000-0000-4000-8000-000000000001";
const senderId = "10000000-0000-4000-8000-000000000002";

const conversation: ConversationSummary = {
  id: "20000000-0000-4000-8000-000000000001",
  participant: {
    id: senderId,
    nome: "Maria Souza",
    username: "maria.souza",
    setor: { id: 2, nome: "Mecânica" },
    avatarUrl: null,
    online: true,
    lastSeenAt: null,
  },
  lastMessage: null,
  unreadCount: 1,
  lastMessageAt: "2026-08-26T12:00:00.000Z",
  lastReadMessageId: null,
};

const message: ChatMessage = {
  id: "30000000-0000-4000-8000-000000000001",
  conversationId: conversation.id,
  senderId,
  content: "O veículo já está pronto para retirada.",
  clientMessageId: "40000000-0000-4000-8000-000000000001",
  createdAt: "2026-08-26T12:00:00.000Z",
  sendStatus: "sent",
};

test("notificacao aceita somente mensagem recebida de outro usuario", () => {
  const incoming: ChatRealtimeEvent = {
    kind: "message",
    conversationId: conversation.id,
    messageId: message.id,
    senderId,
  };
  assert.equal(isIncomingMessageNotification(incoming, currentUserId), true);
  assert.equal(isIncomingMessageNotification({ ...incoming, senderId: currentUserId }, currentUserId), false);
  assert.equal(isIncomingMessageNotification({ ...incoming, kind: "read" }, currentUserId), false);
  assert.equal(isIncomingMessageNotification(incoming, currentUserId, true), false);
});

test("toast exibe nome, setor, iniciais e previa da mensagem", () => {
  const html = renderToStaticMarkup(
    <ChatIncomingMessageToast
      conversation={conversation}
      message={message}
      onDismiss={() => undefined}
    />,
  );
  assert.match(html, /Nova mensagem/);
  assert.match(html, /Maria Souza/);
  assert.match(html, /Mecânica/);
  assert.match(html, /MS/);
  assert.match(html, /O veículo já está pronto para retirada/);
  assert.match(html, /Fechar notificação/);
});

test("toast omite a linha de setor quando o remetente nao possui setor", () => {
  const html = renderToStaticMarkup(
    <ChatIncomingMessageToast
      conversation={{
        ...conversation,
        participant: { ...conversation.participant, setor: null },
      }}
      message={message}
      onDismiss={() => undefined}
    />,
  );
  assert.doesNotMatch(html, /Sem setor/);
});

test("previa preserva o maximo util sem deixar o toast crescer indefinidamente", () => {
  const preview = chatToastPreview(`  ${"mensagem ".repeat(100)}  `);
  assert.equal(preview.length, 600);
  assert.match(preview, /…$/);
  assert.doesNotMatch(chatToastPreview("linha 1\nlinha 2"), /\n/);
});
