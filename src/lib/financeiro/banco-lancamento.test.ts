import assert from "node:assert/strict";
import test from "node:test";
import { erroDeBancoNoLancamento } from "./banco-lancamento";

test("cadastro liquidado exige um identificador de banco válido", () => {
  for (const banco_id of [
    undefined,
    null,
    "",
    " ",
    0,
    -1,
    1.5,
    "inválido",
    NaN,
    Infinity,
  ]) {
    assert.ok(erroDeBancoNoLancamento({ pendente: false, banco_id }));
  }
  assert.ok(erroDeBancoNoLancamento({}));
  assert.equal(erroDeBancoNoLancamento({ pendente: false, banco_id: 7 }), null);
  assert.equal(erroDeBancoNoLancamento({ banco_id: "7" }), null);
});

test("lançamento pendente pode nascer sem conta e passa a exigir ao liquidar", () => {
  const futuro = { pendente: true, banco_id: null };
  assert.equal(erroDeBancoNoLancamento(futuro), null);
  assert.equal(erroDeBancoNoLancamento({ pendente: true }), null);
  assert.ok(erroDeBancoNoLancamento({ ...futuro, pendente: false }));
  assert.equal(
    erroDeBancoNoLancamento({ ...futuro, pendente: false, banco_id: 3 }),
    null,
  );
});
