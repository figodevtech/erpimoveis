import assert from "node:assert/strict";
import test from "node:test";

import { isValidCnpj } from "@/lib/fiscal-identifiers";

import { INSTITUICOES_FINANCEIRAS } from "./instituicoes-financeiras";

test("todo CNPJ da lista de instituições tem dígito verificador válido e é único", () => {
  for (const instituicao of INSTITUICOES_FINANCEIRAS) {
    assert.equal(isValidCnpj(instituicao.cnpj), true, `${instituicao.nome}: ${instituicao.cnpj}`);
  }
  assert.equal(new Set(INSTITUICOES_FINANCEIRAS.map((item) => item.cnpj)).size, INSTITUICOES_FINANCEIRAS.length);
});
