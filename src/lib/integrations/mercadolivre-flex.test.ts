import assert from "node:assert/strict";
import test from "node:test";
import {
  getMercadoLivreItemFlex,
  mercadoLivreFlexErrorMessage,
  resolveMercadoLivreItemFlex,
  setMercadoLivreItemFlex,
} from "./mercadolivre-flex";
import { MercadoLivreApiError } from "./mercadolivre";

async function withFetch<T>(stub: typeof fetch, run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

// Tags reais dos anúncios do Demir.
test("lê a situação do Flex pelas tags de envio do anúncio", () => {
  assert.deepEqual(resolveMercadoLivreItemFlex(["self_service_in"]), { active: true, available: true });
  assert.deepEqual(resolveMercadoLivreItemFlex(["self_service_out", "mandatory_free_shipping", "self_service_available"]), {
    active: false,
    available: true,
  });
  assert.deepEqual(resolveMercadoLivreItemFlex(["mandatory_free_shipping"]), { active: false, available: false });
  assert.deepEqual(resolveMercadoLivreItemFlex(null), { active: false, available: false });
});

test("ativa e desativa pelo recurso próprio, que responde 204 sem corpo", async () => {
  const calls: string[] = [];
  const stub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method} ${String(input)}`);
    return { ok: true, status: 204, async text() { return ""; } } as Response;
  }) as typeof fetch;

  await withFetch(stub, async () => {
    await setMercadoLivreItemFlex("token", "MLB", "MLB5250499767", true);
    await setMercadoLivreItemFlex("token", "MLB", "MLB5250499767", false);
  });

  assert.deepEqual(calls, [
    "POST https://api.mercadolibre.com/flex/sites/MLB/items/MLB5250499767/v2",
    "DELETE https://api.mercadolibre.com/flex/sites/MLB/items/MLB5250499767/v2",
  ]);
});

test("consulta devolve a situação informada pelo Mercado Livre", async () => {
  const stub = (async () =>
    ({ ok: true, status: 200, async text() { return JSON.stringify({ has_flex: true }); } }) as Response) as typeof fetch;

  assert.equal(await withFetch(stub, () => getMercadoLivreItemFlex("token", "MLB", "MLB5244762085")), true);
});

test("recusa do Mercado Livre vira mensagem que o usuário entende", () => {
  const error = (status: number, body: string) => new MercadoLivreApiError("/flex", status, body);

  assert.equal(mercadoLivreFlexErrorMessage(error(400, '{"message":"item is already in flex"}'), true), "Este anúncio já está no Envios Flex.");
  assert.match(mercadoLivreFlexErrorMessage(error(403, '{"message":"item down"}'), true), /não oferece Envios Flex/);
  assert.match(mercadoLivreFlexErrorMessage(error(409, '{"message":"can\'t activate item"}'), true), /Tente novamente em instantes/);
  assert.equal(mercadoLivreFlexErrorMessage(new Error("timeout"), false), "Falha ao desativar o Envios Flex.");
});
