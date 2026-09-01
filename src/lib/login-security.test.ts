import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAppointmentRateLimitKeys,
  buildChecklistVerificationRateLimitKeys,
  buildPublicApprovalRateLimitKeys,
  buildLoginRateLimitKeys,
  buildRecoveryRateLimitKeys,
  credentialsHaveSafeLength,
  getClientIp,
  MAX_LOGIN_IDENTIFIER_LENGTH,
  MAX_LOGIN_PASSWORD_LENGTH,
} from "./login-security";

test("extrai o IP usando os cabecalhos conhecidos do proxy", () => {
  assert.equal(
    getClientIp(new Request("https://erp.local", { headers: { "cf-connecting-ip": "203.0.113.10" } })),
    "203.0.113.10"
  );
  assert.equal(
    getClientIp(new Request("https://erp.local", { headers: { "x-forwarded-for": "198.51.100.2, 10.0.0.1" } })),
    "198.51.100.2"
  );
});

test("gera chaves opacas e estaveis sem armazenar identificador ou IP", () => {
  const previousSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "segredo-de-teste-com-tamanho-suficiente";

  try {
    const request = new Request("https://erp.local", { headers: { "x-real-ip": "192.0.2.4" } });
    const first = buildLoginRateLimitKeys("usuario.teste", request);
    const second = buildLoginRateLimitKeys("usuario.teste", request);

    assert.deepEqual(first, second);
    assert.equal(first.length, 2);
    assert.equal(first.some((key) => key.includes("usuario.teste") || key.includes("192.0.2.4")), false);
  } finally {
    if (typeof previousSecret === "undefined") delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
  }
});

test("separa as chaves de aprovacao publica das chaves de login", () => {
  const previousSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "segredo-de-teste-com-tamanho-suficiente";

  try {
    const request = new Request("https://example.test", {
      headers: { "x-real-ip": "203.0.113.8" },
    });
    const loginKeys = buildLoginRateLimitKeys("cliente", request);
    const approvalKeys = buildPublicApprovalRateLimitKeys("token", request);

    assert.equal(approvalKeys.length, 2);
    assert.notDeepEqual(approvalKeys, loginKeys);
    assert.match(approvalKeys[0], /^approval-token:[a-f0-9]{64}$/);
    assert.match(approvalKeys[1], /^approval-ip:[a-f0-9]{64}$/);

    const checklistKeys = buildChecklistVerificationRateLimitKeys("token", request);
    assert.notDeepEqual(checklistKeys, loginKeys);
    assert.notDeepEqual(checklistKeys, approvalKeys);
    assert.match(checklistKeys[0], /^checklist-verification-token:[a-f0-9]{64}$/);
    assert.match(checklistKeys[1], /^checklist-verification-ip:[a-f0-9]{64}$/);

    const recoveryKeys = buildRecoveryRateLimitKeys("cliente@example.com", request);
    const appointmentKeys = buildAppointmentRateLimitKeys("12345678901", request);
    assert.match(recoveryKeys[0], /^recovery-email:[a-f0-9]{64}$/);
    assert.match(appointmentKeys[0], /^appointment-document:[a-f0-9]{64}$/);
  } finally {
    if (typeof previousSecret === "undefined") delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
  }
});

test("rejeita credenciais vazias ou excessivamente grandes", () => {
  assert.equal(credentialsHaveSafeLength("usuario", "senha"), true);
  assert.equal(credentialsHaveSafeLength("", "senha"), false);
  assert.equal(credentialsHaveSafeLength("a".repeat(MAX_LOGIN_IDENTIFIER_LENGTH + 1), "senha"), false);
  assert.equal(credentialsHaveSafeLength("usuario", "a".repeat(MAX_LOGIN_PASSWORD_LENGTH + 1)), false);
});
