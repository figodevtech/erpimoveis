import assert from "node:assert/strict";
import test from "node:test";
import {
  isMercadoLivreNotificationEventEnabled,
  mercadoLivreNotificationEventForTopic,
  MERCADOLIVRE_NOTIFICATION_EVENT_DEFAULTS,
} from "@/lib/integrations/mercadolivre-notification-events";

test("traduz os tópicos do Mercado Livre para eventos da tela", () => {
  assert.equal(mercadoLivreNotificationEventForTopic("orders_v2"), "PEDIDO");
  assert.equal(mercadoLivreNotificationEventForTopic("shipments"), "ENVIO");
  assert.equal(mercadoLivreNotificationEventForTopic("items_prices"), "PRECO");
  assert.equal(mercadoLivreNotificationEventForTopic("stock-locations"), "ESTOQUE");
  assert.equal(mercadoLivreNotificationEventForTopic("orders_feedback"), "AVALIACAO");
  assert.equal(mercadoLivreNotificationEventForTopic("claims"), "RECLAMACAO");
});

test("sem escolha da empresa vale o padrão: vendas e atendimento ligados, anúncios não", () => {
  assert.equal(isMercadoLivreNotificationEventEnabled("orders_v2", null), true);
  assert.equal(isMercadoLivreNotificationEventEnabled("questions", null), true);
  assert.equal(isMercadoLivreNotificationEventEnabled("items", null), false);
  assert.equal(isMercadoLivreNotificationEventEnabled("items_prices", null), false);
  assert.ok(!MERCADOLIVRE_NOTIFICATION_EVENT_DEFAULTS.includes("ANUNCIO"));
});

test("respeita a escolha da empresa", () => {
  assert.equal(isMercadoLivreNotificationEventEnabled("items", ["ANUNCIO"]), true);
  assert.equal(isMercadoLivreNotificationEventEnabled("orders_v2", ["ANUNCIO"]), false);
  assert.equal(isMercadoLivreNotificationEventEnabled("orders_v2", []), false);
});

test("tópico novo, ainda fora do catálogo, nunca é silenciado por engano", () => {
  assert.equal(mercadoLivreNotificationEventForTopic("flex-handshakes"), null);
  assert.equal(isMercadoLivreNotificationEventEnabled("flex-handshakes", []), true);
});
