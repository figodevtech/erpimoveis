import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { authenticateStaysWebhook, listingSummary, reservationEvents, staysConfig } from "./stays-contract";
import { StaysClient } from "./stays-client";

const env = { STAYS_BASE_URL: "https://test-figo.stays.net", STAYS_CLIENT_ID: "dummy-login", STAYS_CLIENT_SECRET: "dummy-secret" };
const listing = (n: number) => ({ _id: `listing${n}`, id: `CODE${n}`, status: "active", internalName: `Imóvel ${n}` });
const reservation = (type = "booked", id = "reserve1") => ({ _id: id, _idlisting: "listing1", type, checkInDate: "2026-12-24", checkOutDate: "2026-12-27", guest: "Dado privado" });

test("configuração isola conta por domínio e restringe destinos de credenciais", () => {
  assert.equal(staysConfig({}).configured, false);
  const first = staysConfig(env), second = staysConfig({ ...env, STAYS_BASE_URL: "https://other.stays.net" });
  assert.equal(first.configured, true);
  if (first.configured && second.configured) assert.notEqual(first.account, second.account);
  for (const url of ["http://test.stays.net", "https://localhost", "https://stays.net.evil.example", "https://test.stays.net/path", "https://user:password@test.stays.net", "https://test.stays.net?query=x"]) assert.throws(() => staysConfig({ ...env, STAYS_BASE_URL: url }));
});
test("consulta paginada usa somente GET, autenticação Basic e não devolve credenciais", async () => {
  const calls: URL[] = [];
  const client = new StaysClient(env, (async (input, init) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
    assert.equal((init?.headers as Record<string, string>).Authorization, `Basic ${Buffer.from("dummy-login:dummy-secret").toString("base64")}`);
    return Response.json(url.searchParams.get("skip") === "0" ? Array.from({ length: 20 }, (_, n) => listing(n)) : [listing(20)]);
  }) as typeof fetch);
  const result = await client.listings();
  assert.equal(result.length, 21); assert.equal(calls[1].searchParams.get("skip"), "20");
  assert.ok(!JSON.stringify(result).includes("dummy-secret"));
  assert.deepEqual(listingSummary({ ...listing(1), address: "Privado" }), { id: "listing1", code: "CODE1", title: "Imóvel 1", status: "active" });
});
test("paginação repetida, HTTP sem acesso e JSON inválido falham sem resultados parciais", async () => {
  const repeated = new StaysClient(env, (async () => Response.json(Array.from({ length: 20 }, (_, n) => listing(n)))) as typeof fetch);
  await assert.rejects(repeated.listings(), /Paginação inconsistente/);
  const unauthorized = new StaysClient(env, (async () => new Response("private diagnostics", { status: 401 })) as typeof fetch);
  await assert.rejects(unauthorized.listings(), /recusou o acesso/);
  const html = new StaysClient(env, (async () => new Response("<html>Login</html>")) as typeof fetch);
  await assert.rejects(html.listings(), /inválida/);
});
test("reservas geram apenas bloqueios civis, com cancelamento e origem conferida", () => {
  assert.deepEqual(reservationEvents([reservation()], "listing1"), [{ uid: "stays:reserve1", inicio: "2026-12-24", fim: "2026-12-27" }]);
  for (const type of ["reserved", "contract", "blocked", "maintenance"]) assert.equal(reservationEvents([reservation(type)], "listing1").length, 1);
  assert.deepEqual(reservationEvents([reservation("canceled")], "listing1"), []);
  assert.throws(() => reservationEvents([reservation()], "otherListing"));
  assert.throws(() => reservationEvents([reservation(), reservation()], "listing1"));
  assert.throws(() => reservationEvents([{ ...reservation(), checkInDate: "2026-02-30" }], "listing1"));
  assert.throws(() => reservationEvents([{ ...reservation(), type: "unknown" }], "listing1"));
});
test("webhook usa assinatura oficial, rejeita adulteração e produz recibo estável", () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const config = { clientId: "dummy-login", publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString() };
  const message = { action: "reservation.created", _dt: "2026-11-19T15:00:00.000Z", payload: reservation() };
  const signature = sign("SHA256", Buffer.from(JSON.stringify(message)), keys.privateKey).toString("base64");
  const accepted = authenticateStaysWebhook(message, "dummy-login", signature, config);
  assert.ok(accepted);
  assert.equal(accepted.receipt, authenticateStaysWebhook(message, "dummy-login", signature, config)?.receipt);
  assert.equal(authenticateStaysWebhook({ ...message, action: "reservation.canceled" }, "dummy-login", signature, config), null);
  assert.equal(authenticateStaysWebhook(message, "another-login", signature, config), null);
  assert.equal(authenticateStaysWebhook(message, "dummy-login", "invalid", config), null);
  assert.equal(authenticateStaysWebhook(message, "dummy-login", signature, { clientId: "dummy-login" }), null);
});
