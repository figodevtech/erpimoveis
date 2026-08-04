import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  buildShopeeAuthorizationUrl,
  decodeShopeeOAuthContext,
  encodeShopeeOAuthContext,
} from "./shopee";

function withShopeeEnv(run: () => void) {
  const previous = {
    partnerId: process.env.SHOPEE_PARTNER_ID,
    partnerKey: process.env.SHOPEE_PARTNER_KEY,
    redirect: process.env.SHOPEE_REDIRECT_URI,
  };
  process.env.SHOPEE_PARTNER_ID = "12345";
  process.env.SHOPEE_PARTNER_KEY = "test-secret";
  process.env.SHOPEE_REDIRECT_URI = "https://erp.example/api/integracoes/shopee/callback";
  try {
    run();
  } finally {
    if (previous.partnerId === undefined) delete process.env.SHOPEE_PARTNER_ID;
    else process.env.SHOPEE_PARTNER_ID = previous.partnerId;
    if (previous.partnerKey === undefined) delete process.env.SHOPEE_PARTNER_KEY;
    else process.env.SHOPEE_PARTNER_KEY = previous.partnerKey;
    if (previous.redirect === undefined) delete process.env.SHOPEE_REDIRECT_URI;
    else process.env.SHOPEE_REDIRECT_URI = previous.redirect;
  }
}

test("gera URL de autorização Shopee com assinatura HMAC v2", () => {
  withShopeeEnv(() => {
    const url = new URL(buildShopeeAuthorizationUrl());
    const timestamp = url.searchParams.get("timestamp");
    const expected = createHmac("sha256", "test-secret")
      .update(`12345/api/v2/shop/auth_partner${timestamp}`)
      .digest("hex");
    assert.equal(url.searchParams.get("partner_id"), "12345");
    assert.equal(url.searchParams.get("redirect"), "https://erp.example/api/integracoes/shopee/callback");
    assert.equal(url.searchParams.get("sign"), expected);
  });
});

test("contexto OAuth Shopee é assinado e rejeita adulteração", () => {
  withShopeeEnv(() => {
    const context = encodeShopeeOAuthContext(7);
    assert.deepEqual(decodeShopeeOAuthContext(context), { empresaId: 7 });
    assert.equal(decodeShopeeOAuthContext(`${context}x`), null);
  });
});
