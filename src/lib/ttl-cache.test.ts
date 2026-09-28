import assert from "node:assert/strict";
import test from "node:test";

import { createSharedLookup } from "./shared-lookup";
import { createTtlCache } from "./ttl-cache";

function relogio(inicio = 0) {
  let agora = inicio;
  return { now: () => agora, avancar: (ms: number) => { agora += ms; } };
}

test("chamadas simultaneas dividem a mesma leitura", async () => {
  const cache = createTtlCache<string, number>({ ttlMs: 1_000 });
  let leituras = 0;
  const loader = async () => { leituras += 1; return 42; };

  const valores = await Promise.all(Array.from({ length: 25 }, () => cache.get("u1", loader)));

  assert.equal(leituras, 1);
  assert.deepEqual(new Set(valores), new Set([42]));
});

test("entrada vence pelo TTL e volta a ler a origem", async () => {
  const { now, avancar } = relogio();
  const cache = createTtlCache<string, number>({ ttlMs: 15_000, now });
  let leituras = 0;
  const loader = async () => ++leituras;

  assert.equal(await cache.get("u1", loader), 1);
  avancar(14_999);
  assert.equal(await cache.get("u1", loader), 1);
  avancar(1);
  assert.equal(await cache.get("u1", loader), 2);
});

test("promessa rejeitada sai do cache e a proxima chamada le de novo", async () => {
  const cache = createTtlCache<string, string>({ ttlMs: 60_000 });
  let tentativas = 0;
  const loader = async () => {
    tentativas += 1;
    if (tentativas === 1) throw new Error("timeout");
    return "ok";
  };

  await assert.rejects(cache.get("u1", loader), /timeout/);
  assert.equal(cache.size, 0);
  assert.equal(await cache.get("u1", loader), "ok");
  assert.equal(tentativas, 2);
});

test("chamadas em voo durante a falha recebem o erro, mas ele nao fica guardado", async () => {
  const cache = createTtlCache<string, string>({ ttlMs: 60_000 });
  let rejeitar!: (error: Error) => void;
  const primeira = cache.get("u1", () => new Promise((_, reject) => { rejeitar = reject; }));
  const simultanea = cache.get("u1", async () => "nunca chamado");

  rejeitar(new Error("500"));
  await assert.rejects(primeira, /500/);
  await assert.rejects(simultanea, /500/);
  assert.equal(await cache.get("u1", async () => "nova leitura"), "nova leitura");
});

test("falha de uma leitura antiga nao apaga a leitura mais nova", async () => {
  const cache = createTtlCache<string, string>({ ttlMs: 60_000 });
  let rejeitarAntiga!: (error: Error) => void;
  const antiga = cache.get("u1", () => new Promise((_, reject) => { rejeitarAntiga = reject; }));
  const nova = await cache.get("u1", async () => "fresca", { fresh: true });

  rejeitarAntiga(new Error("atrasada"));
  await assert.rejects(antiga, /atrasada/);

  assert.equal(nova, "fresca");
  assert.equal(await cache.get("u1", async () => "nao deveria ler"), "fresca");
});

test("fresh ignora o que esta guardado e invalidate/clear descartam", async () => {
  const cache = createTtlCache<string, number>({ ttlMs: 60_000 });
  let leituras = 0;
  const loader = async () => ++leituras;

  await cache.get("u1", loader);
  assert.equal(await cache.get("u1", loader, { fresh: true }), 2);
  cache.invalidate("u1");
  assert.equal(await cache.get("u1", loader), 3);
  await cache.get("u2", loader);
  cache.clear();
  assert.equal(cache.size, 0);
});

test("respeita o limite de entradas", async () => {
  const cache = createTtlCache<number, number>({ ttlMs: 60_000, maxEntries: 3 });
  for (let i = 0; i < 10; i += 1) await cache.get(i, async () => i);
  assert.equal(cache.size, 3);
});

test("consulta compartilhada: 25 requisicoes simultaneas do middleware fazem 1 leitura", async () => {
  const lookup = createSharedLookup<{ available: boolean }>({ ttlMs: 15_000, keepIf: (v) => v.available });
  let leituras = 0;
  const loader = async () => { leituras += 1; return { available: true }; };

  await Promise.all(Array.from({ length: 25 }, () => lookup("u1", loader)));
  await lookup("u1", loader);

  assert.equal(leituras, 1);
});

test("consulta compartilhada nao guarda resposta indisponivel nem falha", async () => {
  const lookup = createSharedLookup<{ available: boolean }>({ ttlMs: 15_000, keepIf: (v) => v.available });
  let leituras = 0;

  assert.deepEqual(await lookup("u1", async () => { leituras += 1; return { available: false }; }), { available: false });
  await assert.rejects(lookup("u1", async () => { leituras += 1; throw new Error("rede"); }), /rede/);
  assert.deepEqual(await lookup("u1", async () => { leituras += 1; return { available: true }; }), { available: true });

  assert.equal(leituras, 3);
});
