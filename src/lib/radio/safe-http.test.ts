import assert from "node:assert/strict";
import test from "node:test";
import {
  isPublicRadioAddress,
  SafeHttpError,
  SafeRadioHttpClient,
  validateRadioUrlSyntax,
  type RadioDnsResolver,
  type SafeHttpTransport,
} from "./safe-http";

const publicResolver: RadioDnsResolver = async () => [{ address: "93.184.216.34", family: 4 }];

test("bloqueia hostnames e IPv4 internos conhecidos", () => {
  for (const url of [
    "http://localhost/radio",
    "http://127.0.0.1/stream",
    "http://192.168.1.10/stream",
    "http://10.0.0.2/stream",
    "http://169.254.169.254/latest/meta-data",
  ]) {
    assert.throws(() => validateRadioUrlSyntax(url), (error: unknown) => {
      return error instanceof SafeHttpError && error.code === "UNSAFE_URL";
    });
  }
});

test("classifica enderecos publicos e privados", () => {
  assert.equal(isPublicRadioAddress("8.8.8.8"), true);
  assert.equal(isPublicRadioAddress("10.0.0.1"), false);
  assert.equal(isPublicRadioAddress("::1"), false);
  assert.equal(isPublicRadioAddress("fc00::1"), false);
  assert.equal(isPublicRadioAddress("2606:4700:4700::1111"), true);
});

test("bloqueia hostname que resolve para rede privada", async () => {
  const client = new SafeRadioHttpClient(async () => [{ address: "192.168.10.20", family: 4 }], async () => {
    throw new Error("transport nao deveria ser chamado");
  });
  await assert.rejects(client.request("https://radio.test/stream"), (error: unknown) => {
    return error instanceof SafeHttpError && error.code === "UNSAFE_URL";
  });
});

test("valida novamente cada redirect e bloqueia destino privado", async () => {
  const transport: SafeHttpTransport = async () => ({
    status: 302,
    headers: { location: "http://127.0.0.1/admin" },
    body: new Uint8Array(),
    truncated: false,
  });
  const client = new SafeRadioHttpClient(publicResolver, transport);
  await assert.rejects(client.request("https://radio.test/stream"), (error: unknown) => {
    return error instanceof SafeHttpError && error.code === "UNSAFE_URL";
  });
});
