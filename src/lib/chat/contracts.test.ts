import assert from "node:assert/strict";
import test from "node:test";
import { messageCreateSchema, messageReactionSchema } from "./contracts";

test("reacao invalida preserva codigo de erro consumido pela API", () => {
  const result = messageReactionSchema.safeParse({ reaction: "INVALIDA" });
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.error.issues[0].message, "CHAT_INVALID_REACTION");
  assert.deepEqual(messageReactionSchema.parse({ reaction: "CORACAO" }), { reaction: "CORACAO" });
});

test("mensagem normaliza texto e preserva regras de vazio e identificador", () => {
  const clientMessageId = "11111111-1111-4111-8111-111111111111";
  const parsed = messageCreateSchema.parse({ content: " Teste ", clientMessageId });
  assert.equal(parsed.content, "Teste");
  assert.equal(Object.hasOwn(parsed, "replyToMessageId"), false);
  const empty = messageCreateSchema.safeParse({ content: " ", clientMessageId });
  assert.equal(empty.success, false);
  if (!empty.success) assert.equal(empty.error.issues[0].message, "CHAT_EMPTY_MESSAGE");
  assert.equal(messageCreateSchema.safeParse({ content: "Teste", clientMessageId: "invalido" }).success, false);
});
