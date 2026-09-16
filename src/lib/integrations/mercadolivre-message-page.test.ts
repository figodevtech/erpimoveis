import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMessagePage, messageOrderPage } from "./mercadolivre-message-page";

test("parâmetros ausentes mantêm primeira página", () => {
  assert.deepEqual(parseMessagePage(new URLSearchParams()), { orderDbId: undefined, beforeId: undefined, limit: 20 });
});
test("limite de mensagens é limitado a cinquenta", () => {
  assert.equal(parseMessagePage(new URLSearchParams("limit=500")).limit, 50);
});
test("cursor e pedido inválidos são recusados", () => {
  for (const name of ["beforeId", "orderDbId", "limit"]) {
    for (const value of ["", "-1", "0", "NaN", "1.5", "1e3", "9007199254740992"]) {
      assert.throws(() => parseMessagePage(new URLSearchParams({ [name]: value })), { statusCode: 400 });
    }
  }
});
test("registro extra indica próxima página mas não carrega suas mensagens", () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ id: 20 - i }));
  const page = messageOrderPage(rows);
  assert.equal(page.data.length, 10);
  assert.equal(page.nextCursor, 11);
});
test("página final e vazia não oferecem próximo cursor", () => {
  assert.equal(messageOrderPage([{ id: 1 }]).nextCursor, null);
  assert.deepEqual(messageOrderPage([]), { data: [], nextCursor: null });
});
