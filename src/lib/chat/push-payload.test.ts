import assert from "node:assert/strict";
import test from "node:test";

import { CHAT_PUSH_PREVIEW_LENGTH } from "@/lib/chat/contracts";
import {
  buildChatPushPayload,
  chatPushDeepLink,
  chatPushPreview,
  hashPushEndpoint,
} from "./push-payload";

const conversationId = "20000000-0000-4000-8000-000000000001";
const messageId = "30000000-0000-4000-8000-000000000001";

test("previa de texto e limitada e normalizada", () => {
  assert.equal(chatPushPreview({ type: "TEXT", content: "  Peça   chegou\n hoje " }), "Peça chegou hoje");

  const longa = chatPushPreview({ type: "TEXT", content: "a".repeat(500) });
  assert.equal(longa.length, CHAT_PUSH_PREVIEW_LENGTH);
  assert.match(longa, /…$/);
});

test("mensagem de voz nao expoe conteudo algum", () => {
  assert.equal(
    chatPushPreview({ type: "VOICE", content: "" }),
    "Enviou uma mensagem de voz",
  );
});

test("deep link carrega apenas conversa e mensagem", () => {
  const url = chatPushDeepLink(conversationId, messageId);
  assert.equal(url, `/?chat=${conversationId}&message=${messageId}`);
});

test("payload do push nao carrega token nem dado administrativo", () => {
  const payload = buildChatPushPayload({
    conversationId,
    messageId,
    senderName: "João da Silva",
    type: "TEXT",
    content: "A peça da OS chegou?",
  });

  assert.deepEqual(Object.keys(payload).sort(), [
    "body",
    "conversationId",
    "messageId",
    "title",
    "type",
    "url",
  ]);
  assert.equal(payload.type, "chat_message");
  assert.equal(payload.title, "João da Silva");
  assert.equal(payload.body, "A peça da OS chegou?");
});

test("hash do endpoint e estavel e nao devolve o endpoint", () => {
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc-123";
  const hash = hashPushEndpoint(endpoint);
  assert.equal(hash, hashPushEndpoint(endpoint));
  assert.notEqual(hash, hashPushEndpoint(`${endpoint}x`));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(hash, /googleapis/);
});
