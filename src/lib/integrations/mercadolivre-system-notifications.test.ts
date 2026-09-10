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

test("avisa a exclusão do anúncio e que o produto voltou a ficar livre", () => {
  const notification = mercadoLivreSystemNotification({
    notificationId: 48,
    topic: "items",
    resource: "/items/MLB123",
    details: {
      item: { id: "MLB123", status: "closed", sub_status: ["deleted"] },
      listingRemoved: {
        itemId: "MLB123",
        reason: "Anúncio excluído no Mercado Livre.",
        produtos: ["Bucha de para-choque"],
      },
    },
  });
  assert.equal(notification?.title, "Anúncio excluído no Mercado Livre");
  assert.match(notification?.message ?? "", /Bucha de para-choque/);
  assert.match(notification?.message ?? "", /MLB123/);
  assert.match(notification?.message ?? "", /voltou a ficar livre/);
  assert.match(notification?.href ?? "", /secao=products/);
});

test("não cria aviso para tópico sem suporte", () => {
  assert.equal(mercadoLivreSystemNotification({ notificationId: 44, topic: "unknown", resource: "/unknown/1" }), null);
});

test("silencia anúncio sem alteração que interesse a alguém", () => {
  const notification = mercadoLivreSystemNotification({
    notificationId: 49,
    topic: "items",
    resource: "/items/MLB123",
    details: { item: { id: "MLB123", status: "active", title: "Bucha de para-choque", price: 89.9 } },
  });
  assert.equal(notification, null);
});

test("diz no título que o anúncio foi pausado", () => {
  const notification = mercadoLivreSystemNotification({
    notificationId: 50,
    topic: "items",
    resource: "/items/MLB123",
    details: {
      item: { id: "MLB123", status: "paused", title: "Bucha de para-choque", currency_id: "BRL" },
      materialChange: { reason: "ALTERACAO", changes: { status: { before: "active", after: "paused" } } },
    },
  });
  assert.equal(notification?.title, "Anúncio pausado no Mercado Livre");
  assert.equal(notification?.priority, "WARNING");
  assert.match(notification?.message ?? "", /Situação: ativo → pausado/);
});

test("mostra o preço antes e depois quando ele muda no Mercado Livre", () => {
  const notification = mercadoLivreSystemNotification({
    notificationId: 51,
    topic: "items_prices",
    resource: "/items/MLB123/prices",
    details: {
      item: { id: "MLB123", title: "Bucha de para-choque", currency_id: "BRL" },
      materialChange: { reason: "ALTERACAO", changes: { price: { before: 89.9, after: 79.9 } } },
    },
  });
  assert.equal(notification?.title, "Preço alterado no Mercado Livre");
  assert.match(notification?.message ?? "", /89,90/);
  assert.match(notification?.message ?? "", /79,90/);
});

test("avisa quando o anúncio esgota, mas cala em saída parcial de estoque", () => {
  const esgotou = mercadoLivreSystemNotification({
    notificationId: 52,
    topic: "stock-locations",
    resource: "/user-products/MLBU123/stock",
    details: {
      stockChange: { itemId: "MLB123", itemTitle: "Bucha", previousQuantity: 2, currentQuantity: 0, delta: -2 },
    },
  });
  assert.equal(esgotou?.title, "Anúncio esgotado no Mercado Livre");
  assert.equal(esgotou?.priority, "WARNING");

  // A venda que consumiu a unidade já gerou a notificação de pedido.
  const vendaParcial = mercadoLivreSystemNotification({
    notificationId: 53,
    topic: "stock-locations",
    resource: "/user-products/MLBU123/stock",
    details: {
      stockChange: { itemId: "MLB123", itemTitle: "Bucha", previousQuantity: 5, currentQuantity: 4, delta: -1 },
    },
  });
  assert.equal(vendaParcial, null);
});

test("silencia estoque sem variação de quantidade", () => {
  const notification = mercadoLivreSystemNotification({
    notificationId: 54,
    topic: "stock-locations",
    resource: "/user-products/MLBU123/stock",
    details: { stock: { available_quantity: 7 } },
  });
  assert.equal(notification, null);
});
