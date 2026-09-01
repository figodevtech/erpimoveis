import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMercadoLivreQuantityPricePayload,
  validateMercadoLivreQuantityTiers,
} from "./mercadolivre-quantity-pricing";

test("valida e monta preços progressivos B2B por quantidade", () => {
  const tiers = validateMercadoLivreQuantityTiers([
    { quantity: 2, percentage: 5 },
    { quantity: 5, percentage: 10 },
  ]);
  assert.deepEqual(buildMercadoLivreQuantityPricePayload(tiers).price_per_quantity[0], {
    type: "discount_percentage",
    percentage: 5,
    conditions: {
      context_restrictions: ["channel_marketplace", "user_type_business"],
      min_purchase_unit: 2,
      eligible: true,
    },
  });
});

test("recusa faixas incoerentes", () => {
  assert.throws(
    () => validateMercadoLivreQuantityTiers([{ quantity: 5, percentage: 10 }, { quantity: 2, percentage: 15 }]),
    /ordem crescente/,
  );
  assert.throws(
    () => validateMercadoLivreQuantityTiers([{ quantity: 2, percentage: 10 }, { quantity: 5, percentage: 8 }]),
    /desconto deve aumentar/,
  );
});
