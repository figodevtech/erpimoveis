import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMercadoLivrePackageAttributes,
  hasOnlyMercadoLivreValidationWarnings,
  isMercadoLivreListingTypeEnabled,
  resolveMercadoLivreDefaultListingType,
} from "./mercadolivre-listing-validation";

test("serializa dimensões do Mercado Envios no formato aceito pelo Mercado Livre", () => {
  assert.deepEqual(
    buildMercadoLivrePackageAttributes({
      shippingMode: "me2",
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
      weightGrams: 300,
    }),
    [
      { id: "SELLER_PACKAGE_LENGTH", value_name: "20 cm" },
      { id: "SELLER_PACKAGE_WIDTH", value_name: "15 cm" },
      { id: "SELLER_PACKAGE_HEIGHT", value_name: "10 cm" },
      { id: "SELLER_PACKAGE_WEIGHT", value_name: "300 g" },
    ],
  );
});

test("não envia atributos de pacote fora do Mercado Envios 2", () => {
  assert.deepEqual(
    buildMercadoLivrePackageAttributes({
      shippingMode: "custom",
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
      weightGrams: 300,
    }),
    [],
  );
});

test("aceita resposta de pré-validação composta somente por avisos", () => {
  assert.equal(
    hasOnlyMercadoLivreValidationWarnings({
      cause: [
        { type: "warning", code: "shipping.lost_me1_by_user" },
        { type: "warning", code: "shipping.free_shipping.cost_exceeded" },
      ],
    }),
    true,
  );
});

test("não ignora erro real misturado aos avisos", () => {
  assert.equal(
    hasOnlyMercadoLivreValidationWarnings({
      cause: [
        { type: "warning", code: "shipping.lost_me1_by_user" },
        { type: "error", code: "item.invalid" },
      ],
    }),
    false,
  );
});

test("usa o tipo padrão da conta quando ele está disponível para a categoria", () => {
  assert.equal(resolveMercadoLivreDefaultListingType("gold_pro", ["gold_special", "gold_pro"]), "gold_pro");
});

test("volta para Clássico quando o padrão da conta não está disponível", () => {
  assert.equal(resolveMercadoLivreDefaultListingType("free", ["gold_special", "gold_pro"]), "gold_special");
});

test("habilita somente os tipos Clássico e Premium para novos anúncios", () => {
  assert.equal(isMercadoLivreListingTypeEnabled("gold_special"), true);
  assert.equal(isMercadoLivreListingTypeEnabled("gold_pro"), true);

  for (const disabledType of ["free", "gold_premium", "gold", "silver", "bronze"]) {
    assert.equal(isMercadoLivreListingTypeEnabled(disabledType), false, disabledType);
  }
});
