import { test } from "node:test";
import assert from "node:assert/strict";
import { databaseErrorDetail } from "./database-error-detail";

test("preserva coluna e alias dos erros reportados sem inventar tabela", () => {
  for (const column of ["c.nome", "s.nome", "status", "produto_2.codigofornecedor"]) {
    assert.deepEqual(databaseErrorDetail({ code: "42703", message: `column "${column}" does not exist` }), { reason: "MISSING_COLUMN", column });
  }
});
test("extrai schema cache e not-null sem copiar detalhes pessoais", () => {
  assert.deepEqual(databaseErrorDetail({ message: "Could not find the 'nome' column of 'cliente' in the schema cache", details: "secret" }), { reason: "MISSING_COLUMN", column: "nome", table: "cliente" });
  assert.deepEqual(databaseErrorDetail({ message: 'null value in column "nome" of relation "cliente" violates not-null constraint', details: "Failing row contains (personal data)" }), { reason: "NOT_NULL", column: "nome", table: "cliente" });
  assert.deepEqual(databaseErrorDetail({ message: 'relation "public.exemplo" does not exist' }), { reason: "MISSING_RELATION", table: "public.exemplo" });
});
test("omite valores, SQL livre e hints desconhecidos", () => {
  assert.deepEqual(databaseErrorDetail({ code: "22003", message: 'value "12345678901234" is out of range for type integer' }), { reason: "NUMERIC_OVERFLOW" });
  for (const message of ['column "email@example.com" does not exist', 'column "nome" does not exist\nSELECT secret', 'https://user:secret@host', 'arbitrary failure']) {
    assert.equal(databaseErrorDetail({ message, hint: "secret", details: "secret" }), undefined);
  }
  assert.equal(databaseErrorDetail(null), undefined);
});
