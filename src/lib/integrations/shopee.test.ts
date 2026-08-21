import assert from "node:assert/strict";
import test from "node:test";
import { buildShopeeAttributeList, normalizeShopeeAttribute, normalizeShopeeLogisticsChannel, validateShopeeListingLimits, validateShopeePackage } from "./shopee-listing";

test("ERP não exige credenciais globais da Shopee", () => {
  const requiredByErp = ["PLATFORM_API_URL", "PLATFORM_INSTALLATION_ID", "PLATFORM_API_SECRET"];
  assert.equal(requiredByErp.includes("SHOPEE_PARTNER_KEY"), false);
  assert.equal(requiredByErp.includes("SHOPEE_PARTNER_ID"), false);
});

test("normaliza o contrato real de logística do sandbox Shopee", () => {
  const channel = normalizeShopeeLogisticsChannel({
    logistics_channel_id: 91008,
    logistics_channel_name: "Sandbox Shopee Xpress",
    enabled: true,
    weight_limit: { item_min_weight: 0, item_max_weight: 29.9 },
    item_max_dimension: { length: 100, width: 80, height: 60 },
  });
  assert.equal(channel?.id, 91008);
  assert.equal(channel?.name, "Sandbox Shopee Xpress");
  assert.equal(validateShopeePackage({ weight: 30, length: 20, width: 20, height: 20, channels: [channel!] })[0], "Sandbox Shopee Xpress aceita no máximo 29.9 kg.");
});

test("normaliza atributos, tradução e valores exigidos pela categoria", () => {
  const attribute = normalizeShopeeAttribute({
    attribute_id: 100010,
    mandatory: true,
    name: "Material",
    multi_lang: [{ language: "pt-BR", value: "Material do produto" }],
    attribute_value_list: [{ value_id: 8, name: "Metal", multi_lang: [{ language: "pt-BR", value: "Metal" }] }],
    attribute_info: { input_type: 2, max_value_count: 1 },
  }, "pt-BR");
  assert.equal(attribute?.required, true);
  assert.equal(attribute?.name, "Material do produto");
  assert.deepEqual(buildShopeeAttributeList([attribute!], { "100010": "8" }), [{
    attribute_id: 100010,
    attribute_value_list: [{ value_id: 8, original_value_name: "Metal" }],
  }]);
});

test("limita atributos multivalorados ao máximo informado pela Shopee", () => {
  const attribute = normalizeShopeeAttribute({
    attribute_id: 10,
    mandatory: false,
    name: "Cores",
    attribute_info: { input_type: 4, max_value_count: 2 },
  });
  assert.equal(attribute?.inputType, "MULTI_SELECT");
  assert.equal(buildShopeeAttributeList([attribute!], { "10": "Azul,Preto,Branco" })[0].attribute_value_list.length, 2);
});

test("aplica os limites devolvidos pela própria loja Shopee", () => {
  const errors = validateShopeeListingLimits({
    title: "A",
    description: "curta",
    price: 0.5,
    stock: 1_000_000,
    imageCount: 0,
    limits: {
      item_name_length_limit: { min_limit: 2, max_limit: 120 },
      item_description_length_limit: { min_limit: 10, max_limit: 5000 },
      price_limit: { min_limit: 1, max_limit: 499999 },
      stock_limit: { min_limit: 0, max_limit: 999999 },
      item_image_count_limit: { min_limit: 1, max_limit: 10 },
    },
  });
  assert.equal(errors.length, 5);
  assert.match(errors.join(" "), /descrição.*mínimo 10/);
});
