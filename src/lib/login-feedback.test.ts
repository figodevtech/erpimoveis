import assert from "node:assert/strict";
import test from "node:test";

import { getLoginFeedback } from "./login-feedback";

test("diferencia os avisos seguros do fluxo de login", () => {
  assert.equal(getLoginFeedback("MISSING_CREDENTIALS").tone, "info");
  assert.equal(getLoginFeedback("LOGIN_RATE_LIMITED").tone, "warning");
  assert.equal(getLoginFeedback("CAPTCHA_FAILED").tone, "info");
  assert.equal(getLoginFeedback("INVALID_CREDENTIALS").tone, "error");
  assert.equal(getLoginFeedback("LOGIN_INTERNAL_ERROR").tone, "error");
});

test("não diferencia usuário inexistente de senha incorreta", () => {
  assert.deepEqual(
    getLoginFeedback("CredentialsSignin"),
    getLoginFeedback("INVALID_CREDENTIALS"),
  );
  assert.deepEqual(
    getLoginFeedback("credentials"),
    getLoginFeedback("INVALID_CREDENTIALS"),
  );
});

test("trata erro de configuração do Auth.js como indisponibilidade", () => {
  const feedback = getLoginFeedback("Configuration");

  assert.equal(feedback.title, "Serviço de login indisponível");
  assert.equal(feedback.description.includes("senha"), false);
});
