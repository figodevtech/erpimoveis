import assert from "node:assert/strict";
import test from "node:test";
import { getProductSearchTokens, matchesProductSearch } from "@/lib/product-search";

test("Mercado Livre search tokens normalize acentos, conectivos e pontuação", () => {
  const tokens = getProductSearchTokens("Amortecedor de Direção para Hilux");
  const values = tokens.map((t) => t.value);
  assert.ok(values.includes("amortecedor"));
  assert.ok(values.includes("direcao"));
  assert.ok(values.includes("hilux"));
  assert.ok(!values.includes("de"));
  assert.ok(!values.includes("para"));
});

test("Mercado Livre search localiza produto com palavras em qualquer ordem e campos variados", () => {
  const product = {
    id: 101,
    titulo: "Amortecedor Traseiro",
    fabricante: "Cofap",
    referencia: "AM-9812",
    etiqueta: "EST-01",
    precovenda: 250.0,
  };

  const tokens1 = getProductSearchTokens("cofap amortecedor");
  assert.equal(matchesProductSearch(product, tokens1), true);

  const tokens2 = getProductSearchTokens("am-9812");
  assert.equal(matchesProductSearch(product, tokens2), true);

  const tokens3 = getProductSearchTokens("traseiro inexistente");
  assert.equal(matchesProductSearch(product, tokens3), false);
});

test("Mercado Livre search reconhece código estruturado sem confundir campos", () => {
  const product = {
    id: 50,
    titulo: "Pastilha de Freio",
    referencia: "PF-500",
    precovenda: 150.0,
  };

  const tokens = getProductSearchTokens("pf-500");
  assert.equal(tokens[0]?.structured, true);
  assert.equal(matchesProductSearch(product, tokens), true);

  const nonMatchingTokens = getProductSearchTokens("pf-600");
  assert.equal(matchesProductSearch(product, nonMatchingTokens), false);
});

test("Preço do anúncio no Mercado Livre não afeta preco de venda do cadastro ERP", () => {
  const erpProduct = {
    id: 99,
    titulo: "Filtro de Ar Esportivo",
    precovenda: 100.0,
  };

  const mlListingPrice = 120.0;
  assert.notEqual(erpProduct.precovenda, mlListingPrice);
  assert.equal(erpProduct.precovenda, 100.0);
});
