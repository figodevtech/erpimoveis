import assert from "node:assert/strict";
import test from "node:test";
import { statusSelecionados } from "./status-filter";

test("exportação preserva o filtro exclusivo de faturamento e distingue pagamento", () => {
  assert.deepEqual(statusSelecionados("FATURAMENTO"), ["FATURAMENTO"]);
  assert.deepEqual(statusSelecionados("PAGAMENTO"), ["PAGAMENTO"]);
  assert.deepEqual(statusSelecionados(" pagamento, faturamento,PAGAMENTO"), ["PAGAMENTO", "FATURAMENTO"]);
  assert.deepEqual(statusSelecionados(null), []);
});
