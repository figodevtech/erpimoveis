import assert from "node:assert/strict";
import test from "node:test";

import {
  getFocusWebhookSecret,
  isValidFocusWebhookSecret,
} from "./focus-webhook-security";

test("deriva e valida o segredo do webhook sem expor o token da Focus", () => {
  const oldExplicit = process.env.FOCUS_WEBHOOK_SECRET;
  const oldProduction = process.env.FOCUS_NFE_API_TOKEN;
  const oldHomologation = process.env.FOCUS_NFE_API_TOKEN_HOMOLOGACAO;

  delete process.env.FOCUS_WEBHOOK_SECRET;
  process.env.FOCUS_NFE_API_TOKEN = "token-producao-teste";
  process.env.FOCUS_NFE_API_TOKEN_HOMOLOGACAO = "token-homologacao-teste";

  try {
    const productionSecret = getFocusWebhookSecret("PRODUCAO");
    const homologationSecret = getFocusWebhookSecret("HOMOLOGACAO");

    assert.ok(productionSecret);
    assert.ok(homologationSecret);
    assert.notEqual(productionSecret, process.env.FOCUS_NFE_API_TOKEN);
    assert.notEqual(productionSecret, homologationSecret);
    assert.equal(isValidFocusWebhookSecret(productionSecret), true);
    assert.equal(isValidFocusWebhookSecret(homologationSecret), true);
    assert.equal(isValidFocusWebhookSecret("invalido"), false);
  } finally {
    if (oldExplicit === undefined) delete process.env.FOCUS_WEBHOOK_SECRET;
    else process.env.FOCUS_WEBHOOK_SECRET = oldExplicit;
    if (oldProduction === undefined) delete process.env.FOCUS_NFE_API_TOKEN;
    else process.env.FOCUS_NFE_API_TOKEN = oldProduction;
    if (oldHomologation === undefined) delete process.env.FOCUS_NFE_API_TOKEN_HOMOLOGACAO;
    else process.env.FOCUS_NFE_API_TOKEN_HOMOLOGACAO = oldHomologation;
  }
});
