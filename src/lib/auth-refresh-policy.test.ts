import assert from "node:assert/strict";
import test from "node:test";
import { isTerminalSupabaseRefreshFailure, supabaseRefreshRetryDelayMs } from "./auth-refresh-policy";

test("preserva a sessão em falhas transitórias", () => {
  assert.equal(isTerminalSupabaseRefreshFailure(new TypeError("fetch failed")), false);
  assert.equal(isTerminalSupabaseRefreshFailure({ message: "request timed out", status: 504 }), false);
  assert.equal(isTerminalSupabaseRefreshFailure({ code: "refresh_token_already_used" }), false);
});

test("encerra somente refresh tokens explicitamente inválidos", () => {
  assert.equal(isTerminalSupabaseRefreshFailure({ code: "refresh_token_not_found" }), true);
  assert.equal(isTerminalSupabaseRefreshFailure({ message: "Invalid Refresh Token: Refresh Token Not Found" }), true);
});

test("aplica backoff limitado", () => {
  assert.equal(supabaseRefreshRetryDelayMs(1), 15_000);
  assert.equal(supabaseRefreshRetryDelayMs(3), 60_000);
  assert.equal(supabaseRefreshRetryDelayMs(99), 300_000);
});
