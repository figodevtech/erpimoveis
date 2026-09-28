import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAppointmentRateLimitKeys,
  buildChecklistVerificationRateLimitKeys,
  buildChecklistSigningRateLimitKeys,
  buildPublicApprovalRateLimitKeys,
  buildLoginRateLimitKeys,
  buildRecoveryRateLimitKeys,
  credentialsHaveSafeLength,
  getClientIp,
  MAX_LOGIN_IDENTIFIER_LENGTH,
  MAX_LOGIN_PASSWORD_LENGTH,
} from "./login-security";

/**
 * `getClientIp` escolhe o cabeçalho pelo ambiente. O teste declara o cenário em
 * vez de herdar o do processo: no `prebuild` da Vercel, `VERCEL=1` e
 * `NODE_ENV=production` já vêm definidos e desviam para outro ramo.
 */
function comAmbiente(valores: Record<string, string | undefined>, executar: () => void) {
  const anteriores = Object.fromEntries(Object.keys(valores).map((chave) => [chave, process.env[chave]]));
  const aplicar = (origem: Record<string, string | undefined>) => {
    for (const [chave, valor] of Object.entries(origem)) {
      if (typeof valor === "undefined") delete process.env[chave];
      else process.env[chave] = valor;
    }
  };

  aplicar(valores);
  try {
    executar();
  } finally {
    aplicar(anteriores);
  }
}

test("extrai o IP usando os cabecalhos conhecidos do proxy", () => {
  comAmbiente(
    { VERCEL: undefined, TRUST_CLOUDFLARE_PROXY: undefined, TRUST_PROXY_HEADERS: "true" },
    () => {
      assert.equal(
        getClientIp(new Request("https://erp.local", { headers: { "x-real-ip": "203.0.113.10" } })),
        "203.0.113.10"
      );
      assert.equal(
        getClientIp(new Request("https://erp.local", { headers: { "x-forwarded-for": "198.51.100.2, 10.0.0.1" } })),
        "198.51.100.2"
      );
    },
  );
});

test("em producao fora da Vercel nao confia em cabecalho de proxy sem habilitar", () => {
  comAmbiente(
    { VERCEL: undefined, TRUST_CLOUDFLARE_PROXY: undefined, TRUST_PROXY_HEADERS: undefined, NODE_ENV: "production" },
    () => {
      assert.equal(
        getClientIp(new Request("https://erp.local", { headers: { "x-forwarded-for": "198.51.100.2" } })),
        "unknown"
      );
    },
  );
});

test("na Vercel ignora cf-connecting-ip enviado pelo cliente", () => {
  const previousVercel = process.env.VERCEL;
  const previousCloudflare = process.env.TRUST_CLOUDFLARE_PROXY;
  process.env.VERCEL = "1";
  delete process.env.TRUST_CLOUDFLARE_PROXY;

  try {
    assert.equal(
      getClientIp(
        new Request("https://erp.local", {
          headers: {
            "cf-connecting-ip": "198.51.100.99",
            "x-vercel-forwarded-for": "203.0.113.20",
          },
        }),
      ),
      "203.0.113.20",
    );
  } finally {
    if (typeof previousVercel === "undefined") delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    if (typeof previousCloudflare === "undefined") delete process.env.TRUST_CLOUDFLARE_PROXY;
    else process.env.TRUST_CLOUDFLARE_PROXY = previousCloudflare;
  }
});

test("so confia no IP da Cloudflare quando habilitado explicitamente", () => {
  const previousVercel = process.env.VERCEL;
  const previousCloudflare = process.env.TRUST_CLOUDFLARE_PROXY;
  process.env.VERCEL = "1";
  process.env.TRUST_CLOUDFLARE_PROXY = "true";

  try {
    assert.equal(
      getClientIp(
        new Request("https://erp.local", {
          headers: { "cf-connecting-ip": "203.0.113.30" },
        }),
      ),
      "203.0.113.30",
    );
  } finally {
    if (typeof previousVercel === "undefined") delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    if (typeof previousCloudflare === "undefined") delete process.env.TRUST_CLOUDFLARE_PROXY;
    else process.env.TRUST_CLOUDFLARE_PROXY = previousCloudflare;
  }
});

test("gera chaves opacas e estaveis sem armazenar identificador ou IP", () => {
  const previousSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "segredo-de-teste-com-tamanho-suficiente";

  try {
    const request = new Request("https://erp.local", { headers: { "x-real-ip": "192.0.2.4" } });
    const first = buildLoginRateLimitKeys("usuario.teste", request);
    const second = buildLoginRateLimitKeys("usuario.teste", request);

    assert.deepEqual(first, second);
    assert.equal(first.length, 3);
    assert.equal(first.some((key) => key.includes("usuario.teste") || key.includes("192.0.2.4")), false);
    assert.match(first[2], /^login-global:[a-f0-9]{64}$/);
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

    const signingKeys = buildChecklistSigningRateLimitKeys("convite-publico", request);
    assert.notDeepEqual(signingKeys, checklistKeys);
    assert.match(signingKeys[0], /^checklist-signing-invitation:[a-f0-9]{64}$/);
    assert.match(signingKeys[1], /^checklist-signing-ip:[a-f0-9]{64}$/);

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
