import assert from "node:assert/strict";
import test from "node:test";
import { mercadoLivreSystemNotification } from "@/lib/integrations/mercadolivre-system-notification";

test("direciona atualização de pedido para a seção de pedidos", () => {
  const notification = mercadoLivreSystemNotification({
    notificationId: 42,
    topic: "orders_v2",
    resource: "/orders/123456",
  });
  assert.equal(notification?.sourceEventId, "42");
  assert.match(notification?.message ?? "", /123456/);
  assert.match(notification?.href ?? "", /secao=orders/);
});

test("destaca reclamações como aviso de atendimento", () => {
  const notification = mercadoLivreSystemNotification({
    notificationId: 43,
    topic: "claims",
    resource: "/post-purchase/v1/claims/987",
  });
  assert.equal(notification?.priority, "WARNING");
  assert.match(notification?.href ?? "", /secao=atendimento/);
});

test("não cria aviso para tópico sem suporte", () => {
  assert.equal(mercadoLivreSystemNotification({ notificationId: 44, topic: "unknown", resource: "/unknown/1" }), null);
});
