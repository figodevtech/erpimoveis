import { test } from "node:test";
import assert from "node:assert/strict";
import { deliverDiagnostic } from "./erp-diagnostic-delivery";

const config = { url: "https://central.example", installation: "test-installation", secret: "test-only" };
test("Central indisponível não lança erro nem repete envio", async () => {
  let calls = 0;
  const request = (async () => { calls++; throw new Error("network unavailable"); }) as typeof fetch;
  assert.equal(await deliverDiagnostic({}, config, request), false);
  assert.equal(calls, 1);
});
test("credencial recusada permanece falha isolada", async () => {
  assert.equal(await deliverDiagnostic({}, config, (async () => new Response(null, { status: 401 })) as typeof fetch), false);
});
test("não envia segredos por HTTP ou sem configuração", async () => {
  let calls = 0;
  const request = (async () => { calls++; return new Response(); }) as typeof fetch;
  assert.equal(await deliverDiagnostic({}, { ...config, url: "http://central.example" }, request), false);
  assert.equal(await deliverDiagnostic({}, {}, request), false);
  assert.equal(calls, 0);
});
test("envio limitado sem seguir redirecionamento", async () => {
  const request = (async (input, init) => {
    assert.equal(String(input), "https://central.example/api/v1/diagnostics/events");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    assert.equal(init?.method, "POST");
    return new Response(null, { status: 202 });
  }) as typeof fetch;
  assert.equal(await deliverDiagnostic({ code: "22003" }, config, request), true);
});
