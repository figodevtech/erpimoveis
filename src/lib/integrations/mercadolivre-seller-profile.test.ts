import assert from "node:assert/strict";
import test from "node:test";
import { parseMercadoLivreSellerProfile } from "./mercadolivre-seller-profile";

test("identifica reputação e medalha do vendedor", () => {
  assert.deepEqual(
    parseMercadoLivreSellerProfile({
      user_type: "normal",
      status: { site_status: "active", sell: { allow: true } },
      seller_reputation: {
        level_id: "5_green",
        power_seller_status: "platinum",
        transactions: { completed: 1602, total: 2361 },
      },
      tags: ["normal", "business"],
    }),
    {
      userType: "normal",
      accountStatus: "active",
      sellingAllowed: true,
      reputationLevelId: "5_green",
      reputationLabel: "Reputação verde",
      powerSellerStatus: "platinum",
      powerSellerLabel: "MercadoLíder Platinum",
      completedSales: 1602,
      totalSales: 2361,
      businessEnabled: true,
    },
  );
});

test("identifica vendedor novo sem reputação ou medalha", () => {
  const profile = parseMercadoLivreSellerProfile({ seller_reputation: {} });
  assert.equal(profile.reputationLabel, "Vendedor sem reputação");
  assert.equal(profile.powerSellerLabel, null);
});
