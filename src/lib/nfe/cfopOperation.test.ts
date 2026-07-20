import assert from "node:assert/strict";
import test from "node:test";

import {
  expectedCfopPrefix,
  isCfopCompatibleWithOperation,
  normalizeCfopForOperation,
} from "./cfopOperation";

test("resolve o primeiro dígito do CFOP conforme direção e UF", () => {
  assert.equal(expectedCfopPrefix("SAIDA", "PB", "PB"), "5");
  assert.equal(expectedCfopPrefix("SAIDA", "PB", "PE"), "6");
  assert.equal(expectedCfopPrefix("ENTRADA", "PB", "PB"), "1");
  assert.equal(expectedCfopPrefix("ENTRADA", "PB", "PE"), "2");
  assert.equal(expectedCfopPrefix("ENTRADA", "PB", "EX"), "3");
});

test("adapta o CFOP padrão do produto para uma nota de entrada", () => {
  assert.equal(normalizeCfopForOperation("5102", "ENTRADA", "PB", "PB"), "1102");
  assert.equal(normalizeCfopForOperation("6102", "ENTRADA", "PB", "PE"), "2102");
  assert.equal(normalizeCfopForOperation(null, "ENTRADA", "PB", "PB"), "1102");
});

test("valida CFOP contra o sentido da operação", () => {
  assert.equal(isCfopCompatibleWithOperation("1102", "ENTRADA", "PB", "PB"), true);
  assert.equal(isCfopCompatibleWithOperation("5102", "ENTRADA", "PB", "PB"), false);
  assert.equal(isCfopCompatibleWithOperation("6102", "SAIDA", "PB", "PE"), true);
});
