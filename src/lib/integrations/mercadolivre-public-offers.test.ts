import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { processPublicOffer, publicOfferPath } from "./mercadolivre-public-offers";
import { mercadoLivreNotificationEventForTopic } from "./mercadolivre-notification-events";
import { mercadoLivreSystemNotification } from "./mercadolivre-system-notification";

test("oferta consulta v2 e sincroniza exatamente o item retornado", async () => {
  const offer = { id: "OFFER-MLB123-456", item_id: "MLB123", status: { id: "ACTIVE" } };
  const calls: unknown[] = [];
  const result = await processPublicOffer("/seller-promotions/offers/OFFER-MLB123-456",
    async (path) => { calls.push(path); return offer; },
    async (id, data) => { calls.push([id, data]); return { synced: true }; });
  assert.deepEqual(calls, ["/seller-promotions/offers/OFFER-MLB123-456?app_version=v2", ["MLB123", offer]]);
  assert.deepEqual(result, { synced: true });
  assert.equal(publicOfferPath("/seller-promotions/offers/123?app_version=v2"), "/seller-promotions/offers/123?app_version=v2");
});

test("não permite URL externa, traversal ou outro recurso", () => {
  for (const resource of ["https://evil.test/offers/123", "//evil.test", "/items/MLB123", "/seller-promotions/offers/../123", "/seller-promotions/offers/%2f123", "/seller-promotions/offers/123?user_id=2"]) {
    assert.throws(() => publicOfferPath(resource));
  }
});

test("oferta inválida ou erro HTTP não confirma sincronização e permite retry", async () => {
  let synced = false;
  const sync = async () => { synced = true; };
  for (const value of [null, {}, { item_id: "https://evil.test" }]) {
    await assert.rejects(processPublicOffer("/seller-promotions/offers/123", async () => value, sync));
  }
  await assert.rejects(processPublicOffer("/seller-promotions/offers/123", async () => { throw new Error("HTTP 503"); }, sync), /503/);
  assert.equal(synced, false);
});

test("falha de atualização não é transformada em sucesso", async () => {
  await assert.rejects(processPublicOffer("/seller-promotions/offers/123",
    async () => ({ item_id: "MLB123" }), async () => { throw new Error("database offline"); }), /database offline/);
});

test("ofertas respeitam preferência de avisos de preço", () => {
  assert.equal(mercadoLivreNotificationEventForTopic("public_offers"), "PRECO");
});

test("aviso de oferta mostra anúncio e preço anterior/atual; sem mudança fica silencioso", () => {
  const input = { notificationId: 123, topic: "public_offers", resource: "/seller-promotions/offers/123" };
  assert.equal(mercadoLivreSystemNotification(input), null);
  const notification = mercadoLivreSystemNotification({ ...input, details: {
    item: { id: "MLB123", title: "Peça teste", currency_id: "BRL" },
    materialChange: { changes: { price: { before: 100, after: 90 } } },
  } });
  assert.match(notification?.message ?? "", /Peça teste/);
  assert.match(notification?.message ?? "", /100,00/);
  assert.match(notification?.message ?? "", /90,00/);
});

test("processador confere vendedor e lê preço estritamente sem escrever no produto", () => {
  const source = readFileSync(new URL("./mercadolivre-notifications.ts", import.meta.url), "utf8");
  assert.match(source, /String\(item.seller_id\) !== String\(account.ml_user_id\)/);
  assert.match(source, /strict: Boolean\(offer\)/);
  assert.doesNotMatch(source, /\.from\("produto"\)/);
  assert.match(source, /requeuePreviouslyUnsupportedOffers/);
});
