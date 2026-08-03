import assert from "node:assert/strict";
import test from "node:test";

import { parsePostgresIntegerId, POSTGRES_INTEGER_MAX } from "./postgres-id";

test("aceita IDs integer positivos", () => {
  assert.equal(parsePostgresIntegerId(1), 1);
  assert.equal(parsePostgresIntegerId(" 42 "), 42);
  assert.equal(parsePostgresIntegerId(String(POSTGRES_INTEGER_MAX)), POSTGRES_INTEGER_MAX);
});

test("rejeita CNPJ e valores fora do integer do PostgreSQL", () => {
  assert.equal(parsePostgresIntegerId("11419190000100"), null);
  assert.equal(parsePostgresIntegerId(POSTGRES_INTEGER_MAX + 1), null);
});

test("rejeita formatos que não representam um ID inteiro positivo", () => {
  for (const value of [undefined, null, "", "1.5", "abc", 0, -1, 1.5]) {
    assert.equal(parsePostgresIntegerId(value), null);
  }
});
