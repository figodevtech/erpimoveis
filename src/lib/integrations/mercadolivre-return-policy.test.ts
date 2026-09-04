import assert from "node:assert/strict";
import test from "node:test";
import { shouldWaitForMercadoLivreReturnInspection } from "@/lib/integrations/mercadolivre-return-policy";

test("cancelamento simples pode repor o estoque automaticamente", () => {
  assert.equal(
    shouldWaitForMercadoLivreReturnInspection({ id: 1, status: "cancelled", payments: [{ status: "cancelled" }] }),
    false,
  );
});

test("reembolso aguarda a conferência física da devolução", () => {
  assert.equal(
    shouldWaitForMercadoLivreReturnInspection({ id: 2, status: "cancelled", payments: [{ status: "refunded" }] }),
    true,
  );
});

test("reembolso anterior ao despacho pode repor o estoque automaticamente", () => {
  assert.equal(
    shouldWaitForMercadoLivreReturnInspection(
      { id: 5, status: "cancelled", payments: [{ status: "refunded" }] },
      { id: 10, status: "cancelled" },
    ),
    false,
  );
});

test("chargeback e etiquetas de devolução aguardam conferência física", () => {
  assert.equal(shouldWaitForMercadoLivreReturnInspection({ id: 3, status: "cancelled", tags: ["return_pending"] }), true);
  assert.equal(
    shouldWaitForMercadoLivreReturnInspection({ id: 4, status: "cancelled", payments: [{ status: "charged_back" }] }),
    true,
  );
});
