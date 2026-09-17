import assert from "node:assert/strict";
import test from "node:test";
import { mercadoLivreListingHealth } from "./mercadolivre-quality";

test("usa a nota de /performance, e não o health legado", () => {
  // Valores reais: o ERP guardava 0,74 e 0 enquanto o Mercado Livre mostrava 93 e 100.
  assert.equal(mercadoLivreListingHealth({ entity_type: "USER_PRODUCT", score: 93, level_wording: "Profesional" }, 0.74), 0.93);
  assert.equal(mercadoLivreListingHealth({ entity_type: "USER_PRODUCT", score: 100 }, 0), 1);
  assert.equal(mercadoLivreListingHealth({ score: 94.93671 }, null), 0.9493671);
});

test("sem nota calculada, usa o health legado quando ele vier", () => {
  assert.equal(mercadoLivreListingHealth(null, 0.74), 0.74);
  assert.equal(mercadoLivreListingHealth({ score: null }, "0.5"), 0.5);
});

test("sem nota e sem health, não inventa zero", () => {
  assert.equal(mercadoLivreListingHealth(null, null), null);
  assert.equal(mercadoLivreListingHealth({}, undefined), null);
  assert.equal(mercadoLivreListingHealth({ score: "" }, ""), null);
});
