import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ChatMessage, ChatUser, ConversationSummary } from "@/lib/chat/contracts";
import { selectDirectChatUser } from "./chat-actions";
import { ChatMessageBubble } from "./chat-message-bubble";
import { ChatTriggerButton } from "./chat-trigger-button";
import {
  applyConversationReadCounts,
  createOptimisticMessage,
  mergeChatMessages,
  nextReconnectDelay,
  preservedScrollTop,
  shouldShowRealtimeBanner,
} from "./chat-utils";

const conversation: ConversationSummary = {
  id: "20000000-0000-4000-8000-000000000001",
  participant: {
    id: "10000000-0000-4000-8000-000000000002",
    nome: "Usuário B",
    username: "usuario.b",
    setor: null,
    avatarUrl: null,
    online: false,
    lastSeenAt: null,
  },
  lastMessage: null,
  unreadCount: 3,
  lastMessageAt: null,
  lastReadMessageId: null,
};

test("botao do header solicita a abertura do chat", () => {
  let opened = false;
  const element = ChatTriggerButton({ unreadCount: 0, onOpen: () => { opened = true; } });
  const props = element.props as { onClick: () => void };
  props.onClick();
  assert.equal(opened, true);
  assert.match(renderToStaticMarkup(element), /aria-label="Abrir conversas"/);
});

test("selecao de usuario cria ou recupera e abre a conversa", async () => {
  const user = conversation.participant as ChatUser;
  const calls: string[] = [];
  let selectedId = "";

  await selectDirectChatUser(user, {
    createConversation: async (userId) => {
      calls.push(`create:${userId}`);
      return { conversation };
    },
    refreshConversations: async () => { calls.push("refresh"); },
    showConversation: (value) => {
      calls.push("show");
      selectedId = value.id;
    },
  });

  assert.deepEqual(calls, [`create:${user.id}`, "refresh", "show"]);
  assert.equal(selectedId, conversation.id);
});

test("envio otimista entra imediatamente com o mesmo client_message_id", () => {
  const optimistic = createOptimisticMessage({
    conversationId: conversation.id,
    senderId: "10000000-0000-4000-8000-000000000001",
    content: "Mensagem otimista",
    clientMessageId: "30000000-0000-4000-8000-000000000001",
    createdAt: "2026-08-25T18:00:00.000Z",
  });
  const visible = mergeChatMessages([], [optimistic]);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].sendStatus, "sending");
  assert.equal(visible[0].clientMessageId, optimistic.clientMessageId);
});

test("falha temporaria oferece tentar novamente", () => {
  const failed: ChatMessage = {
    ...createOptimisticMessage({
      conversationId: conversation.id,
      senderId: "10000000-0000-4000-8000-000000000001",
      content: "Falhou",
      clientMessageId: "30000000-0000-4000-8000-000000000002",
      createdAt: "2026-08-25T18:00:00.000Z",
    }),
    sendStatus: "failed",
    error: "Não foi possível enviar.",
  };
  const html = renderToStaticMarkup(<ChatMessageBubble message={failed} own onRetry={() => undefined} />);
  assert.match(html, /role="alert"/);
  assert.match(html, /Tentar novamente/);
});

test("leitura atualiza somente a conversa alvo e permite atualizar o badge global", () => {
  const other = { ...conversation, id: "20000000-0000-4000-8000-000000000002", unreadCount: 4 };
  const updated = applyConversationReadCounts([conversation, other], conversation.id, 0);
  const globalUnreadFromApi = 4;
  assert.equal(updated[0].unreadCount, 0);
  assert.equal(updated[1].unreadCount, 4);
  assert.equal(globalUnreadFromApi, updated.reduce((total, item) => total + item.unreadCount, 0));
});

test("carregar mensagens anteriores preserva a posicao visual", () => {
  assert.equal(preservedScrollTop(35, 600, 980), 415);
});

test("reconexao espera cada vez mais, com teto de 30 segundos", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4].map(nextReconnectDelay),
    [1_000, 2_000, 4_000, 8_000, 16_000],
  );
  // Uma queda longa nao pode deixar o chat parado por minutos apos a rede voltar.
  assert.equal(nextReconnectDelay(5), 30_000);
  assert.equal(nextReconnectDelay(40), 30_000);
  assert.equal(nextReconnectDelay(-1), 1_000);
});

test("aviso de conexao reflete somente o canal de mensagens", () => {
  assert.equal(shouldShowRealtimeBanner("connected"), false);
  // A primeira conexao nao avisa nada: a tela ainda esta montando.
  assert.equal(shouldShowRealtimeBanner("connecting"), false);
  assert.equal(shouldShowRealtimeBanner("disconnected"), true);
  assert.equal(shouldShowRealtimeBanner("unavailable"), true);
});
