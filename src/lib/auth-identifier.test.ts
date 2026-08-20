import assert from "node:assert/strict";
import test from "node:test";

import {
  isEmailIdentifier,
  isValidUsername,
  normalizeLoginIdentifier,
  normalizeUsername,
} from "./auth-identifier";

test("normaliza identificadores e nomes de usuario", () => {
  assert.equal(normalizeLoginIdentifier("  Bruno.Silva  "), "bruno.silva");
  assert.equal(normalizeUsername("  ATENDENTE_01 "), "atendente_01");
});

test("distingue e-mail de nome de usuario", () => {
  assert.equal(isEmailIdentifier("pessoa@empresa.com"), true);
  assert.equal(isEmailIdentifier("pessoa.empresa"), false);
});

test("valida o formato permitido para nomes de usuario", () => {
  assert.equal(isValidUsername("joao-pedro_01"), true);
  assert.equal(isValidUsername("ab"), false);
  assert.equal(isValidUsername("joao pedro"), false);
  assert.equal(isValidUsername("joao@empresa"), false);
  assert.equal(isValidUsername("joaoç"), false);
});

