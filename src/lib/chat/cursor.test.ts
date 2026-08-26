import assert from "node:assert/strict";
import test from "node:test";

import { decodeChatCursor, encodeChatCursor } from "./cursor";

test("cursor do chat preserva data e id para ordenacao estavel", () => {
  const cursor = {
    createdAt: "2026-08-25T18:30:00.000Z",
    id: "10000000-0000-4000-8000-000000000001",
  };
  assert.deepEqual(decodeChatCursor(encodeChatCursor(cursor)), cursor);
});

test("cursor adulterado e recusado", () => {
  assert.throws(() => decodeChatCursor("nao-e-um-cursor"), /CHAT_INVALID_CURSOR/);
});

