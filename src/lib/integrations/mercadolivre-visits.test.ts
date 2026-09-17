import assert from "node:assert/strict";
import test from "node:test";
import { loadMercadoLivreItemVisits } from "./mercadolivre-visits";

// Imita a API: um anúncio por chamada; lote recebe o 400 real do Mercado Livre.
function visitsApi(totals: Record<string, number>, failing: string[] = []) {
  const requested: string[] = [];
  const stub = (async (input: RequestInfo | URL) => {
    const ids = new URL(String(input)).searchParams.get("ids") ?? "";
    requested.push(ids);
    const reply = (status: number, body: unknown) =>
      ({ ok: status < 400, status, async text() { return JSON.stringify(body); }, async json() { return body; } }) as Response;
    if (ids.includes(",")) {
      return reply(400, { message: "maximum amount of items to query is 1", error: "validation_parameters", status: 400, cause: [] });
    }
    if (failing.includes(ids)) return reply(403, { message: "At least one policy returned UNAUTHORIZED" });
    return reply(200, { [ids]: totals[ids] ?? 0 });
  }) as typeof fetch;
  return { stub, requested };
}

async function withFetch<T>(stub: typeof fetch, run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("consulta as visitas um anúncio por chamada", async () => {
  const ids = ["MLB7626119274", "mlb5244762085", "MLB5249272887", "MLB1", "MLB2", "MLB3", "MLB7626119274"];
  const api = visitsApi({ MLB7626119274: 8, MLB5244762085: 1, MLB5249272887: 1, MLB1: 0, MLB2: 4, MLB3: 2 });

  const visits = await withFetch(api.stub, () => loadMercadoLivreItemVisits("token", ids));

  assert.equal(api.requested.every((requested) => !requested.includes(",")), true);
  assert.equal(api.requested.length, 6);
  assert.deepEqual(Object.fromEntries(visits), {
    MLB7626119274: 8,
    MLB5244762085: 1,
    MLB5249272887: 1,
    MLB1: 0,
    MLB2: 4,
    MLB3: 2,
  });
});

test("falha de um anúncio não apaga as visitas dos outros", async () => {
  const api = visitsApi({ MLB7626119274: 8, MLB5249272887: 1 }, ["MLB5244762085"]);
  const warn = console.warn;
  console.warn = () => {};
  try {
    const visits = await withFetch(api.stub, () =>
      loadMercadoLivreItemVisits("token", ["MLB7626119274", "MLB5244762085", "MLB5249272887"]),
    );
    assert.deepEqual(Object.fromEntries(visits), { MLB7626119274: 8, MLB5249272887: 1 });
  } finally {
    console.warn = warn;
  }
});
