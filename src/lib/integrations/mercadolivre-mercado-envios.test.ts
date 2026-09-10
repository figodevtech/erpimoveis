import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMercadoLivreShippingDimensions,
  computeMercadoLivreListingCosts,
  mercadoEnviosLogisticLabel,
  normalizeMercadoEnviosQuote,
  parseMercadoLivreShippingDimensions,
  pickMercadoEnviosLogisticType,
  preferencesAllowShippingMode,
  resolveFreeShippingPolicy,
  resolveMercadoEnviosOptions,
  shippingPreferenceLogistics,
  shippingPreferenceModes,
  verifyMercadoEnviosItem,
} from "./mercadolivre-mercado-envios";

/* Dimensões ---------------------------------------------------------------- */

test("monta dimensoes no formato documentado altura x largura x comprimento, peso", () => {
  assert.equal(
    buildMercadoLivreShippingDimensions({ lengthCm: 22, widthCm: 17, heightCm: 9, weightGrams: 462 }),
    "9x17x22,462",
  );
});

test("recusa dimensoes invalidas", () => {
  assert.equal(buildMercadoLivreShippingDimensions({ lengthCm: 0, widthCm: 17, heightCm: 9, weightGrams: 462 }), null);
  assert.equal(buildMercadoLivreShippingDimensions({ lengthCm: 22, widthCm: 17, heightCm: 9, weightGrams: 0 }), null);
});

test("le de volta as dimensoes na mesma ordem em que foram escritas", () => {
  const dimensions = buildMercadoLivreShippingDimensions({ lengthCm: 22, widthCm: 17, heightCm: 9, weightGrams: 462 });
  assert.deepEqual(parseMercadoLivreShippingDimensions(dimensions), {
    heightCm: 9,
    widthCm: 17,
    lengthCm: 22,
    weightGrams: 462,
  });
});

/* Preferências ------------------------------------------------------------- */

const USER_PREFERENCES = {
  modes: ["custom", "not_specified", "me1", "me2"],
  option: "in",
  free_configurations: [{ condition: { value: null, type: "all" }, rule: { default: true, free_mode: "country" } }],
  logistics: [
    { mode: "me1", types: [{ type: "default", default: true }] },
    {
      mode: "me2",
      types: [
        { type: "cross_docking", carrier_pickup: [17501840], default: false },
        { type: "drop_off", carrier_pickup: [], default: true },
      ],
    },
  ],
};

const CATEGORY_PREFERENCES = {
  category_id: "MLB1234",
  dimensions: { weight: 50000, height: 20, width: 60, length: 130 },
  logistics: [
    { types: ["default"], mode: "me1" },
    { types: ["drop_off", "xd_drop_off", "cross_docking", "fulfillment"], mode: "me2" },
    { types: ["custom"], mode: "custom" },
  ],
  restricted: true,
};

test("le modos das preferencias da conta e da categoria", () => {
  assert.deepEqual(shippingPreferenceModes(USER_PREFERENCES), ["custom", "not_specified", "me1", "me2"]);
  assert.deepEqual(shippingPreferenceModes(CATEGORY_PREFERENCES), ["me1", "me2", "custom"]);
});

test("normaliza types como string na categoria e como objeto na conta", () => {
  assert.deepEqual(
    shippingPreferenceLogistics(CATEGORY_PREFERENCES).map((option) => option.type),
    ["drop_off", "xd_drop_off", "cross_docking", "fulfillment"],
  );
  const userLogistics = shippingPreferenceLogistics(USER_PREFERENCES);
  assert.deepEqual(userLogistics.map((option) => option.type), ["cross_docking", "drop_off"]);
  assert.equal(userLogistics.find((option) => option.type === "drop_off")?.default, true);
});

test("lista de modos vazia nao bloqueia: o Mercado Livre nao informou aquele lado", () => {
  assert.deepEqual(preferencesAllowShippingMode("me2", { categoryModes: [], userModes: [] }), {
    allowed: true,
    blockedBy: null,
  });
  assert.deepEqual(preferencesAllowShippingMode("me2", { categoryModes: [], userModes: ["me2", "custom"] }), {
    allowed: true,
    blockedBy: null,
  });
});

test("logisticas sem intersecao nao bloqueiam o modo ME2", () => {
  // Categoria aceita drop_off/xd_drop_off, conta so tem cross_docking: os modos
  // continuam compativeis e quem decide a logistica e o shipping_modes.
  assert.deepEqual(preferencesAllowShippingMode("me2", { categoryModes: ["me2", "custom"], userModes: ["me2", "me1"] }), {
    allowed: true,
    blockedBy: null,
  });
});

test("bloqueia nomeando o lado que recusou o modo", () => {
  assert.deepEqual(preferencesAllowShippingMode("me2", { categoryModes: ["custom"], userModes: ["me2"] }), {
    allowed: false,
    blockedBy: "category",
  });
  assert.deepEqual(preferencesAllowShippingMode("me2", { categoryModes: ["me2"], userModes: ["custom", "me1"] }), {
    allowed: false,
    blockedBy: "seller",
  });
});

/* shipping_modes ----------------------------------------------------------- */

test("ME2 disponivel com logistica retornada", () => {
  const resolved = resolveMercadoEnviosOptions({
    channels: {
      marketplace: {
        available_modes: [
          { mode: "me2", logistic_types: [{ type: "drop_off", default: true }] },
          { mode: "custom", logistic_types: [{ type: "custom" }] },
        ],
      },
    },
  });
  assert.equal(resolved.available, true);
  assert.deepEqual(resolved.availableModes, ["me2", "custom"]);
  assert.deepEqual(resolved.logistics.map((option) => option.type), ["drop_off"]);
});

test("ME2 indisponivel quando available_modes nao traz me2", () => {
  const resolved = resolveMercadoEnviosOptions({
    channels: { marketplace: { available_modes: [{ mode: "custom", logistic_types: [{ type: "custom" }] }] } },
  });
  assert.equal(resolved.available, false);
  assert.deepEqual(resolved.logistics, []);
});

test("varias logisticas: usa a marcada como default", () => {
  const resolved = resolveMercadoEnviosOptions({
    channels: {
      marketplace: {
        available_modes: [
          {
            mode: "me2",
            logistic_types: [
              { type: "drop_off", default: false },
              { type: "cross_docking", default: true },
            ],
          },
        ],
      },
    },
  });
  assert.deepEqual(resolved.logistics.map((option) => option.type), ["drop_off", "cross_docking"]);
  assert.equal(pickMercadoEnviosLogisticType(resolved.logistics, "drop_off"), "cross_docking");
});

test("sem default, respeita a logistica ja selecionada", () => {
  const logistics = [
    { type: "drop_off", default: false, attributes: {} },
    { type: "cross_docking", default: false, attributes: {} },
  ];
  assert.equal(pickMercadoEnviosLogisticType(logistics, "cross_docking"), "cross_docking");
  assert.equal(pickMercadoEnviosLogisticType(logistics, "self_service"), "drop_off");
  assert.equal(pickMercadoEnviosLogisticType([], "drop_off"), null);
});

/* Frete grátis ------------------------------------------------------------- */

test("politica de frete gratis obrigatoria quando o Mercado Livre marca mandatory_free_shipping", () => {
  assert.equal(
    resolveFreeShippingPolicy({
      mercadoEnviosAvailable: true,
      logistics: [{ type: "drop_off", default: true, attributes: { mandatory_free_shipping: true } }],
    }),
    "mandatory",
  );
  assert.equal(
    resolveFreeShippingPolicy({ mercadoEnviosAvailable: true, itemTags: ["mandatory_free_shipping"] }),
    "mandatory",
  );
});

test("politica de frete gratis opcional quando a conta tem free_configurations", () => {
  assert.equal(
    resolveFreeShippingPolicy({ mercadoEnviosAvailable: true, userPreferences: USER_PREFERENCES }),
    "optional",
  );
});

test("politica indisponivel quando o Mercado Envios nao esta disponivel", () => {
  assert.equal(resolveFreeShippingPolicy({ mercadoEnviosAvailable: false }), "unavailable");
});

test("politica desconhecida quando o Mercado Livre nao informa nada", () => {
  assert.equal(resolveFreeShippingPolicy({ mercadoEnviosAvailable: true }), "unknown");
});

/* Cotação ------------------------------------------------------------------ */

test("normaliza a cotacao a partir de coverage.all_country", () => {
  const quote = normalizeMercadoEnviosQuote(
    { coverage: { all_country: { list_cost: 27.9, currency_id: "BRL", billable_weight: 1200 } } },
    { freeShipping: true, logisticType: "drop_off" },
  );
  assert.equal(quote.sellerShippingCost, 27.9);
  assert.equal(quote.currencyId, "BRL");
  assert.equal(quote.billableWeight, 1200);
  assert.equal(quote.freeShipping, true);
  assert.equal(quote.logisticType, "drop_off");
});

test("nao inventa custo zero quando o Mercado Livre nao devolve valor", () => {
  const quote = normalizeMercadoEnviosQuote({ coverage: {} }, { freeShipping: false, logisticType: "drop_off" });
  assert.equal(quote.sellerShippingCost, null);
  assert.equal(quote.billableWeight, null);
});

test("guarda o valor antes do desconto quando ha promocao", () => {
  const quote = normalizeMercadoEnviosQuote(
    {
      coverage: {
        all_country: { list_cost: 120, currency_id: "BRL", billable_weight: 900 },
        discount: { rate: 0.4, type: "loyal", promoted_amount: 200 },
      },
    },
    { freeShipping: true, logisticType: "drop_off" },
  );
  assert.equal(quote.sellerShippingCost, 120);
  assert.equal(quote.listCostBeforeDiscount, 200);
  assert.equal(quote.discountRate, 0.4);
});

/* Custos ------------------------------------------------------------------- */

test("sale_fee_amount ja inclui a taxa fixa e nao pode ser somada de novo", () => {
  const costs = computeMercadoLivreListingCosts({
    price: 150,
    saleFeeAmount: 22.5,
    fixedFee: 6,
    percentageFee: 11,
    sellerShippingCost: 27.9,
  });
  assert.equal(costs.marketplaceCost, 22.5);
  assert.equal(costs.fixedFee, 6);
  assert.equal(costs.estimatedNetAmount, 99.6);
  assert.notEqual(costs.estimatedNetAmount, 150 - 22.5 - 6 - 27.9);
});

test("sem taxa retornada, o liquido fica indefinido", () => {
  const costs = computeMercadoLivreListingCosts({ price: 150, saleFeeAmount: null, sellerShippingCost: 27.9 });
  assert.equal(costs.marketplaceCost, null);
  assert.equal(costs.estimatedNetAmount, null);
});

test("sem custo de frete, o liquido considera apenas o custo por vender", () => {
  const costs = computeMercadoLivreListingCosts({ price: 150, saleFeeAmount: 22.5, sellerShippingCost: null });
  assert.equal(costs.estimatedNetAmount, 127.5);
});

/* Pós-publicação ----------------------------------------------------------- */

test("aceita anuncio publicado com me2 e logistica", () => {
  const check = verifyMercadoEnviosItem(
    { shipping: { mode: "me2", logistic_type: "drop_off", local_pick_up: false } },
    { expectedLogisticType: "drop_off" },
  );
  assert.equal(check.ok, true);
  assert.equal(check.logisticMismatch, false);
  assert.deepEqual(check.reasons, []);
});

test("recusa anuncio publicado fora do me2", () => {
  const check = verifyMercadoEnviosItem({ shipping: { mode: "custom" } });
  assert.equal(check.ok, false);
  assert.ok(check.reasons.length > 0);
});

test("recusa anuncio publicado com retirada local quando ME2 e exigido", () => {
  const check = verifyMercadoEnviosItem({
    shipping: { mode: "me2", logistic_type: "drop_off", local_pick_up: true },
  });
  assert.equal(check.ok, false);
});

test("logistica diferente mas valida em ME2 e divergencia, nao falha", () => {
  const check = verifyMercadoEnviosItem(
    { shipping: { mode: "me2", logistic_type: "cross_docking", local_pick_up: false } },
    { expectedLogisticType: "drop_off" },
  );
  assert.equal(check.ok, true);
  assert.equal(check.logisticMismatch, true);
  assert.equal(check.expectedLogisticType, "drop_off");
});

test("aponta divergencia de frete gratis contra o cenario escolhido", () => {
  const check = verifyMercadoEnviosItem(
    { shipping: { mode: "me2", logistic_type: "drop_off", local_pick_up: false, free_shipping: false } },
    { expectedLogisticType: "drop_off", expectedFreeShipping: true },
  );
  assert.equal(check.ok, true);
  assert.equal(check.reasons.length, 1);
});

/* Rótulos ------------------------------------------------------------------ */

test("usa rotulo amigavel mas preserva o codigo desconhecido", () => {
  assert.equal(mercadoEnviosLogisticLabel("drop_off"), "Agência / ponto de despacho");
  assert.equal(mercadoEnviosLogisticLabel("fulfillment"), "Mercado Envios Full");
  assert.equal(mercadoEnviosLogisticLabel("modo_novo"), "modo_novo");
});
