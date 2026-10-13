import assert from "node:assert/strict";
import { test } from "node:test";
import { createOrdensRealtimeConnection } from "./realtime-client";
import { ordensRealtimeCredentialsSchema } from "./realtime-contracts";

const credentials = { userId: "11111111-1111-4111-8111-111111111111", tenantId: 1, topic: "ordens:tenant:1", token: "token-A", expiresAt: new Date(Date.now() + 600_000).toISOString() };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function harness() {
  const channels: Array<{ broadcast?: (value: { payload: unknown }) => void; status?: (value: string) => void; removed?: boolean }> = [];
  const tokens: string[] = [];
  let source: (() => Promise<string | null>) | undefined;
  let fetches = 0;
  const changes: Array<string | undefined> = [];
  const client = {
    channel: (_topic: string, options: unknown) => {
      assert.deepEqual(options, { config: { private: true } });
      const callbacks: typeof channels[number] = {};
      channels.push(callbacks);
      const channel = {
        on: (_type: string, _event: unknown, callback: typeof callbacks.broadcast) => { callbacks.broadcast = callback; return channel; },
        subscribe: (callback: typeof callbacks.status) => { callbacks.status = callback; return channel; },
      };
      return channel;
    },
    removeChannel: async () => { channels[channels.length - 1].removed = true; return "ok"; },
    realtime: { setAuth: async (token: string) => { tokens.push(token); }, disconnect: () => undefined },
  };
  const connection = createOrdensRealtimeConnection({
    fetchCredentials: async () => ({ ...credentials, token: `token-${++fetches}` }),
    createClient: accessToken => { source = accessToken; return client as never; },
    onChange: table => changes.push(table),
  });
  return { connection, channels, tokens, changes, token: () => source!() };
}

test("canal privado entrega alterações e reconcilia o join", async () => {
  const h = harness();
  try {
    await flush();
    h.channels[0].status!("SUBSCRIBED");
    for (const table of ["ordemservico", "osservico", "osservico_realizador"]) h.channels[0].broadcast!({ payload: { table } });
    h.channels[0].broadcast!({ payload: { table: "usuario", status: "inventado" } });
    assert.deepEqual(h.changes, [undefined, "ordemservico", "osservico", "osservico_realizador"]);
    assert.equal(await h.token(), "token-1");
  } finally { h.connection.dispose(); }
});

test("reconexão troca o token e ignora eventos da conexão antiga", async () => {
  const h = harness();
  try {
    await flush();
    const old = h.channels[0];
    old.status!("SUBSCRIBED");
    h.connection.reconnect();
    await flush();
    old.broadcast!({ payload: { table: "ordemservico" } });
    h.channels[1].status!("SUBSCRIBED");
    h.channels[1].broadcast!({ payload: { table: "ordemservico" } });
    assert.deepEqual(h.changes, [undefined, undefined, "ordemservico"]);
    assert.equal(await h.token(), "token-2");
    assert.equal(old.removed, true);
  } finally { h.connection.dispose(); }
});

test("desmontagem durante a busca não cria canal nem usa token atrasado", async () => {
  let release!: (value: typeof credentials) => void;
  let clients = 0;
  const connection = createOrdensRealtimeConnection({
    fetchCredentials: () => new Promise(resolve => { release = resolve; }),
    createClient: () => { clients++; throw new Error("Não deve criar canal"); },
    onChange: () => { throw new Error("Não deve atualizar tela desmontada"); },
  });
  await flush();
  connection.dispose();
  release(credentials);
  await flush();
  assert.equal(clients, 0);
});

test("credencial rejeita tópico de outra empresa e tabela fora do contrato", () => {
  assert.equal(ordensRealtimeCredentialsSchema.safeParse(credentials).success, true);
  assert.equal(ordensRealtimeCredentialsSchema.safeParse({ ...credentials, topic: "ordens:tenant:2" }).success, false);
});

test("renova a credencial sem abrir outro socket nem perder os listeners", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  try {
    await flush();
    h.channels[0].status!("SUBSCRIBED");
    t.mock.timers.tick(600_000);
    await flush();
    assert.deepEqual(h.tokens, ["token-1", "token-2"]);
    assert.equal(await h.token(), "token-2");
    assert.equal(h.channels.length, 1);
    h.channels[0].broadcast!({ payload: { table: "ordemservico" } });
    assert.equal(h.changes.at(-1), "ordemservico");
  } finally { h.connection.dispose(); t.mock.timers.reset(); }
});
