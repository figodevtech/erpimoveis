import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMercadoLivreReturn } from "./mercadolivre-return";

test("normaliza devolucao V2 com codigo de postagem dentro de shipments", () => {
  assert.deepEqual(
    normalizeMercadoLivreReturn({
      id: "123",
      status: "opened",
      shipments: [{
        shipment_id: 987,
        type: "return",
        status: "label_generated",
        tracking_number: "ME123456789BR",
        total_quantity: 2,
        return_quantity: 1,
        destination: { name: "Loja", shipping_address: { address_line: "Rua A, 10" } },
      }],
    }),
    {
      id: "123",
      status: "opened",
      trackingNumber: "ME123456789BR",
      shipmentId: 987,
      shipmentStatus: "label_generated",
      destinationName: "Loja",
      destinationAddress: "Rua A, 10",
      totalQuantity: 2,
      returnQuantity: 1,
    },
  );
});

test("mantem compatibilidade com resposta antiga de devolucao", () => {
  const summary = normalizeMercadoLivreReturn({
    id: 10,
    status: "pending",
    shipment: { id: 20, tracking_number: "LEGACY123" },
  });
  assert.equal(summary.id, "10");
  assert.equal(summary.shipmentId, 20);
  assert.equal(summary.trackingNumber, "LEGACY123");
});
