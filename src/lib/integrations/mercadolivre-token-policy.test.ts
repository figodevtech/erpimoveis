import { test } from "node:test";
import assert from "node:assert/strict";
import { canReuseMercadoLivreToken } from "./mercadolivre-token-policy";
const now = Date.parse("2026-09-15T12:00:00Z");
const account = { id: 1, access_token: "test", expires_at: new Date(now + 600_000).toISOString() };
test("token válido já carregado dispensa releitura", () => assert.equal(canReuseMercadoLivreToken(account, undefined, now), true));
test("token rejeitado exige consulta mesmo antes de expirar", () => assert.equal(canReuseMercadoLivreToken(account, "test", now), false));
test("expiração ausente ou inválida não permite reutilização", () => {
  for (const expires_at of [undefined, null, "invalid", new Date(now + 300_000).toISOString()]) {
    assert.equal(canReuseMercadoLivreToken({ ...account, expires_at }, undefined, now), false);
  }
});
