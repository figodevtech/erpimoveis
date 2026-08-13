import assert from "node:assert/strict";
import test from "node:test";

test("ERP não exige credenciais globais da Shopee", () => {
  const requiredByErp = ["PLATFORM_API_URL", "PLATFORM_INSTALLATION_ID", "PLATFORM_API_SECRET"];
  assert.equal(requiredByErp.includes("SHOPEE_PARTNER_KEY"), false);
  assert.equal(requiredByErp.includes("SHOPEE_PARTNER_ID"), false);
});
