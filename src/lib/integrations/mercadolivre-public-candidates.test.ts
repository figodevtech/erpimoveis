import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { processPublicCandidate, publicCandidatePath } from "./mercadolivre-public-candidates";
import {
  isMercadoLivreNotificationEventEnabled,
  mercadoLivreNotificationEventForTopic,
} from "./mercadolivre-notification-events";
import { mercadoLivreSystemNotification } from "./mercadolivre-system-notification";

// Respostas reais da API para o convite recebido em 25/10/2026.
const RESOURCE = "/seller-promotions/candidates/CANDIDATE-MLB7658510548-77559646157";
const CANDIDATE = { id: "CANDIDATE-MLB7658510548-77559646157", item_id: "MLB7658510548", promotion_id: "P-MLB17937078", type: "SMART", status: { id: "candidate" } };
const ITEM = { id: "MLB7658510548", title: "Módulo Do Motor Volvo Fh D13", seller_id: 3661049541, price: 10000, currency_id: "BRL" };
const PROMOTIONS = [
  { id: "P-MLB17937078", type: "SMART", ref_id: CANDIDATE.id, status: "candidate", price: 9700, meli_percentage: 1.8, seller_percentage: 1.2, original_price: 10000, name: "Impulsione suas vendas" },
  { type: "PRICE_DISCOUNT", status: "candidate", price: 0, original_price: 10000, name: "" },
  { id: "P-MLB17909028", type: "DEAL", status: "candidate", price: 0, original_price: 10000, start_date: "2026-10-19T00:00:00-03:00", finish_date: "2026-11-12T00:00:00-03:00", name: "11.11 da Black", min_discounted_price: 2000, max_discounted_price: 9700, suggested_discounted_price: 8700 },
];

function api(responses: Record<string, unknown>) {
  const calls: string[] = [];
  return { calls, get: async (path: string) => { calls.push(path); return path in responses ? responses[path] : null; } };
}

test("convite consulta candidato v2, anúncio e promoção do item", async () => {
  const { calls, get } = api({
    [`${RESOURCE}?app_version=v2`]: CANDIDATE,
    "/items/MLB7658510548": ITEM,
    "/seller-promotions/items/MLB7658510548?app_version=v2": PROMOTIONS,
  });
  const result = await processPublicCandidate(RESOURCE, 3661049541, get);
  assert.deepEqual(calls, [`${RESOURCE}?app_version=v2`, "/items/MLB7658510548", "/seller-promotions/items/MLB7658510548?app_version=v2"]);
  assert.deepEqual(result, { candidate: CANDIDATE, item: ITEM, promotion: PROMOTIONS[0] });
});

test("não permite URL externa, traversal ou outro recurso", () => {
  for (const resource of ["https://evil.test/seller-promotions/candidates/1", "//evil.test", "/items/MLB123", "/seller-promotions/offers/123", "/seller-promotions/candidates/../1", "/seller-promotions/candidates/%2f1", "/seller-promotions/candidates/1?user_id=2"]) {
    assert.throws(() => publicCandidatePath(resource));
  }
  assert.equal(publicCandidatePath(`${RESOURCE}?app_version=v2`), `${RESOURCE}?app_version=v2`);
});

test("convite que sumiu ou já foi respondido encerra sem consultar o anúncio", async () => {
  const gone = api({});
  assert.deepEqual(await processPublicCandidate(RESOURCE, 1, gone.get), { candidate: null });
  assert.equal(gone.calls.length, 1);
  const answered = { ...CANDIDATE, status: { id: "started" } };
  const accepted = api({ [`${RESOURCE}?app_version=v2`]: answered });
  assert.deepEqual(await processPublicCandidate(RESOURCE, 1, accepted.get), { candidate: answered });
  assert.equal(accepted.calls.length, 1);
});

test("candidato inválido, de outra conta ou com erro HTTP vai para retentativa", async () => {
  for (const value of [{}, { ...CANDIDATE, item_id: "https://evil.test" }]) {
    await assert.rejects(processPublicCandidate(RESOURCE, 3661049541, api({ [`${RESOURCE}?app_version=v2`]: value }).get));
  }
  await assert.rejects(processPublicCandidate(RESOURCE, 999, api({
    [`${RESOURCE}?app_version=v2`]: CANDIDATE, "/items/MLB7658510548": ITEM,
  }).get), /não pertence/);
  await assert.rejects(processPublicCandidate(RESOURCE, 3661049541, async () => { throw new Error("HTTP 503"); }), /503/);
});

test("convites respeitam o evento de promoção, desligado por padrão", () => {
  assert.equal(mercadoLivreNotificationEventForTopic("public_candidates"), "PROMOCAO");
  assert.equal(isMercadoLivreNotificationEventEnabled("public_candidates", null), false);
  assert.equal(isMercadoLivreNotificationEventEnabled("public_candidates", ["PROMOCAO"]), true);
});

test("aviso de co-participação mostra preço e quem cobre o desconto, um por convite", () => {
  const input = { topic: "public_candidates", resource: RESOURCE };
  const first = mercadoLivreSystemNotification({ ...input, notificationId: 415, details: { candidate: CANDIDATE, item: ITEM, promotion: PROMOTIONS[0] } });
  const again = mercadoLivreSystemNotification({ ...input, notificationId: 429, details: { candidate: CANDIDATE, item: ITEM, promotion: PROMOTIONS[0] } });
  assert.equal(first?.sourceEventId, `public_candidates:${CANDIDATE.id}`);
  assert.equal(again?.sourceEventId, first?.sourceEventId);
  assert.equal(first?.metadata?.event, "PROMOCAO");
  assert.equal(first?.metadata?.itemId, "MLB7658510548");
  const message = first?.message ?? "";
  assert.match(message, /Módulo Do Motor Volvo/);
  assert.match(message, /Promoção: Impulsione suas vendas · Tipo: co-participação/);
  assert.match(message, /10\.000,00 → R\$\s9\.700,00/);
  assert.match(message, /Desconto do Mercado Livre: 1,8% · Seu desconto: 1,2%/);
});

test("aviso de campanha mostra preço sugerido, faixa e período", () => {
  const candidate = { ...CANDIDATE, id: "CANDIDATE-MLB7658510548-1", promotion_id: "P-MLB17909028", type: "DEAL" };
  const message = mercadoLivreSystemNotification({ notificationId: 1, topic: "public_candidates", resource: RESOURCE, details: { candidate, item: ITEM, promotion: PROMOTIONS[2] } })?.message ?? "";
  assert.match(message, /Preço sugerido: R\$\s10\.000,00 → R\$\s8\.700,00/);
  assert.match(message, /Faixa permitida: R\$\s2\.000,00 a R\$\s9\.700,00/);
  assert.match(message, /Período: 19\/10\/2026 a 12\/11\/2026/);
  assert.doesNotMatch(message, /Desconto do Mercado Livre/);
});

test("sem convite em aberto não há aviso, nem na reconciliação", () => {
  const input = { notificationId: 1, topic: "public_candidates", resource: RESOURCE };
  assert.equal(mercadoLivreSystemNotification(input), null);
  assert.equal(mercadoLivreSystemNotification({ ...input, details: { candidate: null } }), null);
  assert.equal(mercadoLivreSystemNotification({ ...input, details: { candidate: { ...CANDIDATE, status: { id: "started" } } } }), null);
});

test("eventos ignorados antes do processador voltam para a fila", () => {
  const source = readFileSync(new URL("./mercadolivre-notifications.ts", import.meta.url), "utf8");
  assert.match(source, /\["user_products", "user_products_families", "public_candidates"\]/);
  assert.match(source, /topic === "public_candidates"/);
});
