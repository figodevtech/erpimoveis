import assert from "node:assert/strict";
import test from "node:test";

import { calculateFinancialSurcharge, calculateFinancialTotal } from "./financial-surcharge";

test("aplica acréscimo fixo somente ao total financeiro", () => {
  assert.equal(calculateFinancialSurcharge(100, "FIXO", 15), 15);
  assert.equal(calculateFinancialTotal(100, "FIXO", 15), 115);
});

test("aplica acréscimo percentual sobre o total comercial após descontos", () => {
  assert.equal(calculateFinancialSurcharge(90, "PORCENTAGEM", 10), 9);
  assert.equal(calculateFinancialTotal(90, "PORCENTAGEM", 10), 99);
});

test("ignora tipo ausente e impede valores negativos", () => {
  assert.equal(calculateFinancialTotal(100, null, 25), 100);
  assert.equal(calculateFinancialTotal(100, "FIXO", -10), 100);
});
