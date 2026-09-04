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

test("inclui a pergunta e o anúncio na notificação", () => {
  const notification = mercadoLivreSystemNotification({
    notificationId: 45,
    topic: "questions",
    resource: "/questions/456",
    details: {
      question: { id: 456, item_id: "MLB123", text: "Serve no modelo 2020?", status: "UNANSWERED", from: { id: 789 } },
      item: { id: "MLB123", title: "Kit de suspensão dianteira" },
    },
  });
  assert.match(notification?.title ?? "", /Kit de suspensão dianteira/);
  assert.match(notification?.message ?? "", /Serve no modelo 2020/);
  assert.match(notification?.message ?? "", /MLB123/);
  assert.match(notification?.message ?? "", /789/);
});

test("inclui produto, quantidade, total e comprador na notificação do pedido", () => {
  const notification = mercadoLivreSystemNotification({
    notificationId: 46,
    topic: "orders_v2",
    resource: "/orders/123456",
    details: {
      order: {
        id: 123456,
        status: "paid",
        total_amount: 149.9,
        currency_id: "BRL",
        buyer: { nickname: "CLIENTE_TESTE" },
        payments: [{ status: "approved" }],
        order_items: [{ quantity: 2, item: { title: "Pastilha de freio" } }],
      },
    },
  });
  assert.match(notification?.message ?? "", /Pastilha de freio \(2 un\.\)/);
  assert.match(notification?.message ?? "", /149,90/);
  assert.match(notification?.message ?? "", /CLIENTE_TESTE/);
  assert.match(notification?.message ?? "", /Pagamento: aprovado/);
});

test("detalha estoque anterior, quantidade adicionada e estoque atual", () => {
  const notification = mercadoLivreSystemNotification({
    notificationId: 47,
    topic: "stock-locations",
    resource: "/user-products/MLBU123/stock",
    details: {
      stockChange: {
        itemId: "MLB123",
        itemTitle: "Bucha de para-choque",
        previousQuantity: 4,
        currentQuantity: 11,
        delta: 7,
      },
    },
  });
  assert.equal(notification?.title, "Estoque adicionado no Mercado Livre");
  assert.match(notification?.message ?? "", /Bucha de para-choque/);
  assert.match(notification?.message ?? "", /Estoque anterior: 4/);
  assert.match(notification?.message ?? "", /Movimentação: \+7 adicionados/);
  assert.match(notification?.message ?? "", /Estoque atual: 11/);
});

test("não cria aviso para tópico sem suporte", () => {
  assert.equal(mercadoLivreSystemNotification({ notificationId: 44, topic: "unknown", resource: "/unknown/1" }), null);
});
