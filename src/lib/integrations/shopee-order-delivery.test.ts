import assert from "node:assert/strict";
import test from "node:test";
import { entregaAvancada, entregaDoPedidoShopee } from "./shopee-order-delivery";

test("status do pedido Shopee vira a entrega da venda", () => {
  assert.equal(entregaDoPedidoShopee("READY_TO_SHIP"), "SEPARACAO");
  assert.equal(entregaDoPedidoShopee("processed"), "SEPARACAO");
  assert.equal(entregaDoPedidoShopee("SHIPPED"), "ENVIO");
  assert.equal(entregaDoPedidoShopee("TO_CONFIRM_RECEIVE"), "ENTREGUE");
  assert.equal(entregaDoPedidoShopee("COMPLETED"), "ENTREGUE");
  for (const semEntrega of ["UNPAID", "CANCELLED", "IN_CANCEL", "TO_RETURN", undefined]) {
    assert.equal(entregaDoPedidoShopee(semEntrega), null);
  }
});

test("a sincronização só avança a entrega", () => {
  assert.equal(entregaAvancada(null, "SEPARACAO"), "SEPARACAO");
  assert.equal(entregaAvancada("SEPARACAO", "ENTREGUE"), "ENTREGUE");
  assert.equal(entregaAvancada("ENVIO", "SEPARACAO"), null);
  assert.equal(entregaAvancada("ENTREGUE", "ENTREGUE"), null);
  assert.equal(entregaAvancada("ENVIO", null), null);
});
