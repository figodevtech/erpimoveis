import assert from "node:assert/strict";
import test from "node:test";
import { lerComissaoVenda } from "./comissao";

test("relatórios leem o valor persistido inclusive quando difere de uma multiplicação nova", () => {
  const snapshot = { base: "900.00", percentual: "12", valor_comissao: "107.99", integrada: true };
  assert.equal(lerComissaoVenda(snapshot)?.valor_comissao, 107.99);
  assert.deepEqual(lerComissaoVenda([snapshot]), lerComissaoVenda(snapshot));
});
test("comissão ausente não é inventada e zero permanece válido", () => {
  assert.equal(lerComissaoVenda(null), null);
  assert.equal(lerComissaoVenda([]), null);
  assert.equal(lerComissaoVenda({ base: 100, percentual: 0, valor_comissao: 0 })?.valor_comissao, 0);
});
