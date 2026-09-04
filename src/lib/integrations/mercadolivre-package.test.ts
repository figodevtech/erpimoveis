import assert from "node:assert/strict";
import test from "node:test";
import { extractMercadoLivrePackageSnapshot } from "./mercadolivre-package";

test("extrai medidas do formato de shipping do Mercado Livre", () => {
  assert.deepEqual(extractMercadoLivrePackageSnapshot({ shipping: { dimensions: "20x15x10,300" } }), {
    package_length_cm: 20,
    package_width_cm: 15,
    package_height_cm: 10,
    package_weight_grams: 300,
  });
});

test("extrai medidas dos atributos do anuncio vinculado", () => {
  const snapshot = extractMercadoLivrePackageSnapshot({
    attributes: [
      { id: "SELLER_PACKAGE_LENGTH", value_struct: { number: 20, unit: "cm" } },
      { id: "SELLER_PACKAGE_WIDTH", value_name: "15 cm" },
      { id: "SELLER_PACKAGE_HEIGHT", value_struct: { number: 10, unit: "cm" } },
      { id: "SELLER_PACKAGE_WEIGHT", value_struct: { number: 300, unit: "g" } },
    ],
  });
  assert.deepEqual(snapshot, {
    package_length_cm: 20,
    package_width_cm: 15,
    package_height_cm: 10,
    package_weight_grams: 300,
  });
});
