import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMercadoLivreTopic, mercadoLivreFamilyHeaders } from "./mercadolivre-notification-topic";
import { mercadoLivreNotificationEventForTopic, isMercadoLivreNotificationEventEnabled } from "./mercadolivre-notification-events";

test("assinaturas atuais e legadas usam o mesmo processador e preferência", () => {
  for (const topic of ["user_products_families", "user-products-families"]) {
    assert.equal(normalizeMercadoLivreTopic(topic), "user-products-families");
    assert.equal(mercadoLivreNotificationEventForTopic(topic), "FAMILIA");
    assert.equal(isMercadoLivreNotificationEventEnabled(topic, []), false);
  }
  assert.equal(normalizeMercadoLivreTopic("user_products"), "user-products");
  assert.equal(mercadoLivreNotificationEventForTopic("user_products"), "FAMILIA");
  for (const topic of ["stock-location", "stock_locations", "stock-locations"]) {
    assert.equal(mercadoLivreNotificationEventForTopic(topic), "ESTOQUE");
  }
  assert.equal(normalizeMercadoLivreTopic("orders_v2"), "orders_v2");
  assert.equal(normalizeMercadoLivreTopic("items_prices"), "items_prices");
});

test("famílias globais exigem API v2; famílias locais preservam contrato", () => {
  assert.deepEqual(mercadoLivreFamilyHeaders("/sites/GBL/user-products-families/8142599365373390"), { "X-API-Version": "2" });
  assert.deepEqual(mercadoLivreFamilyHeaders("/sites/MLB/user-products-families/123"), {});
});
