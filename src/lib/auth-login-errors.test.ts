import assert from "node:assert/strict";
import test from "node:test";
import { CredentialsSignin } from "next-auth";

import { LoginCredentialsError } from "./auth-login-errors";

test("expõe ao Auth.js apenas códigos seguros de erro de login", () => {
  const error = new LoginCredentialsError("LOGIN_RATE_LIMITED");

  assert.equal(error instanceof CredentialsSignin, true);
  assert.equal(error.code, "LOGIN_RATE_LIMITED");
  assert.equal(error.type, "CredentialsSignin");
});
