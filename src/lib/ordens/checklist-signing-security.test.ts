import assert from "node:assert/strict";
import test from "node:test";
import {
  checklistAssetKey,
  checklistInvitationPasswordValid,
  checklistInvitationStatus,
  cpfInvitationHmac,
  createChecklistInvitationToken,
  createChecklistSigningSession,
  decryptInvitationCpf,
  encryptInvitationCpf,
  hashChecklistInvitationPassword,
  validateChecklistSigningOrigin,
  verifyChecklistInvitationPassword,
  verifyChecklistInvitationToken,
  verifyChecklistSigningSession,
} from "./checklist-signing-security";

const SECRET = "segredo-de-teste-especifico-para-checklists-2026";

async function withSecret(run: () => Promise<void> | void) {
  const previous = process.env.CHECKLIST_SIGNING_SECRET;
  process.env.CHECKLIST_SIGNING_SECRET = SECRET;
  try { await run(); } finally {
    if (typeof previous === "undefined") delete process.env.CHECKLIST_SIGNING_SECRET;
    else process.env.CHECKLIST_SIGNING_SECRET = previous;
  }
}

test("aceita somente senha numérica de 4 a 8 dígitos e valida scrypt", async () => withSecret(async () => {
  assert.equal(checklistInvitationPasswordValid("1234"), true);
  assert.equal(checklistInvitationPasswordValid("12345678"), true);
  assert.equal(checklistInvitationPasswordValid("123"), false);
  assert.equal(checklistInvitationPasswordValid("123456789"), false);
  assert.equal(checklistInvitationPasswordValid("12a4"), false);

  const stored = await hashChecklistInvitationPassword("482731");
  assert.equal(await verifyChecklistInvitationPassword({ password: "482731", ...stored }), true);
  assert.equal(await verifyChecklistInvitationPassword({ password: "482732", ...stored }), false);
  assert.equal(stored.hash.includes("482731"), false);
}));

test("protege CPF com HMAC estável e cifra autenticada não determinística", async () => withSecret(() => {
  const cpf = "52998224725";
  assert.equal(cpfInvitationHmac(cpf), cpfInvitationHmac(cpf));
  assert.notEqual(cpfInvitationHmac(cpf), cpfInvitationHmac("52998224724"));
  assert.equal(cpfInvitationHmac(cpf).includes(cpf), false);

  const first = encryptInvitationCpf(cpf);
  const second = encryptInvitationCpf(cpf);
  assert.notEqual(first, second);
  assert.equal(decryptInvitationCpf(first), cpf);
  const parts = first.split(".");
  parts[2] = `${parts[2][0] === "a" ? "b" : "a"}${parts[2].slice(1)}`;
  assert.throws(() => decryptInvitationCpf(parts.join(".")));
}));

test("assina token do convite, detecta adulteração e vincula documento", async () => withSecret(() => {
  const token = createChecklistInvitationToken({
    invitationPublicId: "10000000-0000-4000-8000-000000000001",
    documentPublicId: "20000000-0000-4000-8000-000000000002",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  const payload = verifyChecklistInvitationToken(token);
  assert.equal(payload?.i, "10000000-0000-4000-8000-000000000001");
  assert.equal(payload?.d, "20000000-0000-4000-8000-000000000002");
  const last = token.at(-1) === "a" ? "b" : "a";
  assert.equal(verifyChecklistInvitationToken(`${token.slice(0, -1)}${last}`), null);
}));

test("sessão é vinculada ao convite e expira em sessenta minutos", async () => withSecret(() => {
  const session = createChecklistSigningSession({
    invitationPublicId: "10000000-0000-4000-8000-000000000001",
    documentPublicId: "20000000-0000-4000-8000-000000000002",
    cpfHmac: "a".repeat(64),
  });
  const payload = verifyChecklistSigningSession(session);
  assert.equal(payload?.i, "10000000-0000-4000-8000-000000000001");
  assert.ok((payload?.e ?? 0) <= Math.floor(Date.now() / 1_000) + 3_600);
  const expired = createChecklistSigningSession({
    invitationPublicId: "10000000-0000-4000-8000-000000000001",
    documentPublicId: "20000000-0000-4000-8000-000000000002",
    cpfHmac: "a".repeat(64),
    durationSeconds: -1,
  });
  assert.equal(verifyChecklistSigningSession(expired), null);
}));

test("chave de ativo muda entre convites e origem cruzada é recusada", async () => withSecret(() => {
  const path = "assets/fotos/segredo.jpg";
  const first = checklistAssetKey("10000000-0000-4000-8000-000000000001", path);
  const second = checklistAssetKey("20000000-0000-4000-8000-000000000002", path);
  assert.notEqual(first, second);
  assert.equal(first.includes(path), false);
  assert.equal(validateChecklistSigningOrigin(new Request("https://erp.example/api", {
    method: "POST",
    headers: { origin: "https://erp.example", "sec-fetch-site": "same-origin" },
  })), true);
  assert.equal(validateChecklistSigningOrigin(new Request("https://erp.example/api", {
    method: "POST",
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
  })), false);
}));

test("deriva todos os estados do convite sem reativar versões superadas", () => {
  const base = {
    consumedAt: null,
    revokedAt: null,
    revocationReason: null,
    expiresAt: "2030-01-01T00:00:00.000Z",
    hasNewerVersion: false,
    documentSigned: false,
    now: Date.parse("2029-01-01T00:00:00.000Z"),
  };
  assert.equal(checklistInvitationStatus(base), "ATIVO");
  assert.equal(checklistInvitationStatus({ ...base, expiresAt: "2028-01-01T00:00:00.000Z" }), "EXPIRADO");
  assert.equal(checklistInvitationStatus({ ...base, revokedAt: "2029-01-01T01:00:00.000Z" }), "REVOGADO");
  assert.equal(checklistInvitationStatus({ ...base, hasNewerVersion: true }), "SUPERADO");
  assert.equal(checklistInvitationStatus({ ...base, consumedAt: "2029-01-01T01:00:00.000Z" }), "UTILIZADO");
});
