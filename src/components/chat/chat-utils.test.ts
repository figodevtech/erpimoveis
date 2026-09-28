import assert from "node:assert/strict";
import test from "node:test";

import type { ChatMessage, ChatRealtimeEvent, ConversationSummary } from "@/lib/chat/contracts";
import {
  appendedMessageKeys,
  chatMessageStableKey,
  eventChangesUnread,
  filterConversations,
  isTemporaryMessageError,
  mergeChatMessages,
  unreadBadgeLabel,
} from "./chat-utils";

const conversation: ConversationSummary = {
  id: "20000000-0000-4000-8000-000000000001",
  participant: {
    id: "10000000-0000-4000-8000-000000000002",
    nome: "João da Silva",
    username: "joao.silva",
    setor: { id: 2, nome: "Mecânica" },
    avatarUrl: null,
    online: false,
    lastSeenAt: null,
  },
  lastMessage: null,
  unreadCount: 0,
  lastMessageAt: null,
  lastReadMessageId: null,
};

test("badge global limita a exibicao visual em 99+", () => {
  assert.equal(unreadBadgeLabel(0), "0");
  assert.equal(unreadBadgeLabel(99), "99");
  assert.equal(unreadBadgeLabel(100), "99+");
});

test("busca de conversas ignora acentos e cobre nome, username e setor", () => {
  assert.equal(filterConversations([conversation], "joao").length, 1);
  assert.equal(filterConversations([conversation], "mecanica").length, 1);
  assert.equal(filterConversations([conversation], "funilaria").length, 0);
});

test("resposta e evento realtime conciliam a mensagem otimista sem duplicar", () => {
  const optimistic: ChatMessage = {
    id: "optimistic:client-1",
    conversationId: conversation.id,
    senderId: "10000000-0000-4000-8000-000000000001",
    type: "TEXT",
    content: "Teste",
    clientMessageId: "30000000-0000-4000-8000-000000000001",
    createdAt: "2026-08-25T18:00:00.000Z",
    editedAt: null,
    deletedForEveryoneAt: null,
    reply: null,
    audio: null,
    reactions: [],
    sendStatus: "sending",
  };
  const persisted: ChatMessage = {
    ...optimistic,
    id: "40000000-0000-4000-8000-000000000001",
    createdAt: "2026-08-25T18:00:00.100Z",
    sendStatus: "sent",
  };

  const merged = mergeChatMessages([optimistic], [persisted, persisted]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, persisted.id);
  assert.equal(merged[0].sendStatus, "sent");
});

test("nova tentativa diferencia falha temporaria de erro definitivo", () => {
  assert.equal(isTemporaryMessageError(0), true);
  assert.equal(isTemporaryMessageError(503), true);
  assert.equal(isTemporaryMessageError(400), false);
  assert.equal(isTemporaryMessageError(403), false);
});

test("animacao de entrada ignora historico inicial e pagina anterior", () => {
  assert.deepEqual([...appendedMessageKeys([], ["m2", "m3"], false)], []);
  assert.deepEqual([...appendedMessageKeys(["m2", "m3"], ["m1", "m2", "m3"], true)], []);
  assert.deepEqual([...appendedMessageKeys(["m2", "m3"], ["m2", "m3", "m4"], true)], ["m4"]);
});

test("chave visual permanece estavel na conciliacao da mensagem otimista", () => {
  const optimistic: ChatMessage = {
    id: "optimistic:client-visual",
    conversationId: conversation.id,
    senderId: "10000000-0000-4000-8000-000000000001",
    type: "TEXT",
    content: "Teste visual",
    clientMessageId: "30000000-0000-4000-8000-000000000099",
    createdAt: "2026-08-25T18:00:00.000Z",
    editedAt: null,
    deletedForEveryoneAt: null,
    reply: null,
    audio: null,
    reactions: [],
    sendStatus: "sending",
  };
  const persisted = { ...optimistic, id: "40000000-0000-4000-8000-000000000099", sendStatus: "sent" as const };

  assert.equal(chatMessageStableKey(optimistic), chatMessageStableKey(persisted));
});

test("so eventos que mudam minhas nao lidas pedem chat_unread_count", () => {
  const eu = "10000000-0000-4000-8000-000000000001";
  const outro = "10000000-0000-4000-8000-000000000002";
  const evento = (patch: Partial<ChatRealtimeEvent>): ChatRealtimeEvent => ({
    kind: "message",
    conversationId: "20000000-0000-4000-8000-000000000001",
    ...patch,
  });

  assert.equal(eventChangesUnread(evento({ kind: "message", senderId: outro }), eu), true);
  assert.equal(eventChangesUnread(evento({ kind: "message", senderId: eu }), eu), false);
  assert.equal(eventChangesUnread(evento({ kind: "message" }), eu), true);
  assert.equal(eventChangesUnread(evento({ kind: "read", readerId: eu }), eu), true);
  assert.equal(eventChangesUnread(evento({ kind: "read", readerId: outro }), eu), false);
  assert.equal(eventChangesUnread(evento({ kind: "reaction" }), eu), false);
  assert.equal(eventChangesUnread(evento({ kind: "message-updated" }), eu), true);
  assert.equal(eventChangesUnread(evento({ kind: "conversation" }), eu), true);
});
