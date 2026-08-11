import assert from "node:assert/strict";
import test from "node:test";

import {
  calcularTotalDocumentoEntrada,
  parcelasFechamTotalDocumento,
} from "./entrada-fiscal";

test("entrada fiscal mista soma revenda e uso e consumo no total financeiro", () => {
  assert.equal(calcularTotalDocumentoEntrada(125.4, 74.6), 200);
});

test("entrada de um único estoque preserva o próprio total", () => {
  assert.equal(calcularTotalDocumentoEntrada(125.4, null), 125.4);
  assert.equal(calcularTotalDocumentoEntrada(null, 74.6), 74.6);
});

test("parcelas precisam fechar exatamente o total completo da nota", () => {
  assert.equal(parcelasFechamTotalDocumento(200, [100, 100]), true);
  assert.equal(parcelasFechamTotalDocumento(200, [62.7, 37.3]), false);
  assert.equal(parcelasFechamTotalDocumento(200, [100, 99.99]), false);
});
