import assert from "node:assert/strict";
import test from "node:test";

import { getProductSearchTokens, matchesProductSearch } from "./product-search";

const matches = (product: Record<string, unknown>, query: string) =>
  matchesProductSearch(product, getProductSearchTokens(query));

test("exige que uma etiqueta estruturada apareça inteira no mesmo campo", () => {
  assert.equal(matches({ etiqueta: "PL-39", id: 390, precovenda: 39 }, "pl-39"), true);
  assert.equal(matches({ etiqueta: "PL-20", id: 39, precovenda: 39 }, "pl-39"), false);
});

test("mantém busca sem acentos, sem conectivos e independente da ordem", () => {
  const product = { titulo: "Filtro de combustível" };
  assert.equal(matches(product, "combustível para filtro"), true);
  assert.equal(matches(product, "filtro de combustivel"), true);
});

test("permite palavras comuns distribuídas em campos úteis", () => {
  const product = { titulo: "Filtro", fabricante: "Bosch", grupo: { nome: "Combustível" } };
  assert.equal(matches(product, "bosch combustível filtro"), true);
});

test("não usa ids, datas ou preços para completar códigos", () => {
  const product = { etiqueta: "PL-20", id: 39, createdat: "2039-01-01", precovenda: 39 };
  assert.equal(matches(product, "pl-39"), false);
});
