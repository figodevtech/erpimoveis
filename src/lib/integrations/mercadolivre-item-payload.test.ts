import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMercadoLivreItemPayload,
  buildShippingPayload,
  collectMercadoLivreListingRequestErrors,
  parseMercadoLivreListingRequest,
  runMercadoLivreItemValidation,
} from "./mercadolivre-item-payload";

const BASE_BODY = {
  produtoId: 10,
  title: "Filtro de óleo teste",
  categoryId: "mlb1234",
  price: 150,
  availableQuantity: 3,
  condition: "new",
  listingTypeId: "gold_special",
  pictureUrl: [
    "https://exemplo.com/foto-1.jpg",
    "https://exemplo.com/foto-2.jpg",
    "https://exemplo.com/foto-3.jpg",
  ].join("\n"),
  shippingMode: "me2",
  logisticType: "drop_off",
  freeShipping: false,
  localPickup: false,
  lengthCm: 22,
  widthCm: 17,
  heightCm: 9,
  weightGrams: 462,
};

/* Payload de envio --------------------------------------------------------- */

test("payload ME2 usa apenas os campos documentados e nao envia logistic_type", () => {
  const shipping = buildShippingPayload({ shippingMode: "me2", freeShipping: false }) as Record<string, unknown>;
  assert.deepEqual(shipping, { mode: "me2", local_pick_up: false, free_shipping: false, free_methods: [] });
  assert.equal("logistic_type" in shipping, false);
});

test("payload de retirada e de envio personalizado seguem funcionando", () => {
  assert.deepEqual(buildShippingPayload({ shippingMode: "pickup", freeShipping: false }), {
    mode: "custom",
    free_shipping: true,
    local_pick_up: true,
    methods: [],
  });
  assert.deepEqual(
    buildShippingPayload({
      shippingMode: "custom",
      freeShipping: false,
      customShippingDescription: "Sedex",
      customShippingCost: 30,
      customShippingDeadlineDays: 5,
    }),
    {
      mode: "custom",
      free_shipping: false,
      local_pick_up: false,
      methods: [],
      costs: [{ description: "Sedex - prazo 5 dia(s) úteis", cost: 30 }],
    },
  );
});

/* Payload do anúncio ------------------------------------------------------- */

test("monta o anuncio com atributos de embalagem sem duplicar", () => {
  const request = parseMercadoLivreListingRequest({ ...BASE_BODY, brand: "Fram", model: "PH3600" });
  const { payload, attributes } = buildMercadoLivreItemPayload({
    ...request,
    pictures: [{ source: "https://exemplo.com/foto.jpg" }],
    userProductSeller: false,
  });

  assert.equal(payload.title, "Filtro de óleo teste");
  assert.equal(payload.category_id, "MLB1234");
  assert.equal(payload.currency_id, "BRL");
  const packageAttributes = attributes.filter((attribute) => attribute.id.startsWith("SELLER_PACKAGE_"));
  assert.deepEqual(packageAttributes.map((attribute) => attribute.value_name), ["22 cm", "17 cm", "9 cm", "462 g"]);
  assert.equal(new Set(attributes.map((attribute) => attribute.id)).size, attributes.length);
});

test("conta user_product envia family_name a partir do titulo, nunca title", () => {
  const request = parseMercadoLivreListingRequest({ ...BASE_BODY, brand: "Fram", model: "PH3600" });
  const { payload } = buildMercadoLivreItemPayload({
    ...request,
    pictures: [{ source: "https://exemplo.com/foto.jpg" }],
    userProductSeller: true,
  });
  // O formulário expõe um campo de nome só; o que o usuário digitou tem de chegar.
  assert.equal(payload.title, undefined);
  assert.equal(payload.family_name, "Filtro de óleo teste");
});

test("family_name recorre a marca, modelo e peca quando o titulo esta vazio", () => {
  const request = parseMercadoLivreListingRequest({ ...BASE_BODY, title: "", brand: "Fram", model: "PH3600" });
  const { payload } = buildMercadoLivreItemPayload({
    ...request,
    pictures: [{ source: "https://exemplo.com/foto.jpg" }],
    userProductSeller: true,
  });
  assert.equal(payload.family_name, "Fram PH3600");
});

test("um familyName explicito ainda prevalece para chamadas que enviem um nome proprio", () => {
  const request = parseMercadoLivreListingRequest({ ...BASE_BODY, familyName: "Wega WO-120" });
  const { payload } = buildMercadoLivreItemPayload({
    ...request,
    pictures: [{ source: "https://exemplo.com/foto.jpg" }],
    userProductSeller: true,
  });
  assert.equal(payload.family_name, "Wega WO-120");
});

/* Validações de formulário -------------------------------------------------- */

test("aceita um anuncio ME2 completo", () => {
  const request = parseMercadoLivreListingRequest(BASE_BODY);
  assert.deepEqual(collectMercadoLivreListingRequestErrors(request), []);
});

test("recusa anuncio com menos de três fotos válidas e distintas", () => {
  const errors = collectMercadoLivreListingRequestErrors(
    parseMercadoLivreListingRequest({
      ...BASE_BODY,
      pictureUrl: [
        "https://exemplo.com/repetida.jpg",
        "https://exemplo.com/repetida.jpg",
        "arquivo-local.jpg",
        "https://exemplo.com/segunda.jpg",
      ].join("\n"),
    }),
  );

  const imageError = errors.find((issue) => issue.field === "images");
  assert.ok(imageError);
  assert.match(imageError.message, /Adicione mais 1 foto/);
});

test("exige logistica e dimensoes quando o modo e ME2", () => {
  const semLogistica = collectMercadoLivreListingRequestErrors(
    parseMercadoLivreListingRequest({ ...BASE_BODY, logisticType: "" }),
  );
  assert.ok(semLogistica.some((issue) => issue.field === "shipping"));

  const semPeso = collectMercadoLivreListingRequestErrors(
    parseMercadoLivreListingRequest({ ...BASE_BODY, weightGrams: 0 }),
  );
  assert.ok(semPeso.some((issue) => issue.field === "dimensions"));
});

/* /items/validate ---------------------------------------------------------- */

async function withFetch<T>(stub: typeof fetch, run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("204 No Content e validacao bem-sucedida e nao le JSON", async () => {
  let jsonCalls = 0;
  const stub = (async () =>
    ({
      ok: true,
      status: 204,
      async text() {
        throw new Error("204 não possui corpo");
      },
      async json() {
        jsonCalls += 1;
        throw new Error("204 não possui corpo");
      },
    }) as unknown as Response) as unknown as typeof fetch;

  const result = await withFetch(stub, () => runMercadoLivreItemValidation("token", { category_id: "MLB1234" }));
  assert.equal(result.valid, true);
  assert.equal(result.status, 204);
  assert.equal(jsonCalls, 0);
  assert.deepEqual(result.errors, []);
});

test("429 local_rate_limited repete a validacao em vez de recusar", async () => {
  let calls = 0;
  const stub = (async () => {
    calls += 1;
    return (calls === 1
      ? { ok: false, status: 429, async text() { return JSON.stringify({ message: "local_rate_limited", status: 429 }); } }
      : { ok: true, status: 204, async text() { return ""; } }) as unknown as Response;
  }) as unknown as typeof fetch;

  const result = await withFetch(stub, () => runMercadoLivreItemValidation("token", {}));
  assert.equal(calls, 2);
  assert.equal(result.valid, true);
});

test("429 persistente explica o limite sem chamar de recusa", async () => {
  let calls = 0;
  const stub = (async () => {
    calls += 1;
    return { ok: false, status: 429, async text() { return JSON.stringify({ message: "local_rate_limited", status: 429 }); } } as unknown as Response;
  }) as unknown as typeof fetch;

  const result = await withFetch(stub, () => runMercadoLivreItemValidation("token", {}));
  assert.equal(calls, 3);
  assert.equal(result.valid, false);
  assert.equal(result.status, 429);
  assert.match(result.errors.join(" "), /limitou as requisições/);
  assert.doesNotMatch(result.errors.join(" "), /recusou/);
});

test("400 com causas de erro invalida a publicacao e mapeia o campo", async () => {
  const body = JSON.stringify({
    message: "body.invalid_fields",
    cause: [{ type: "error", code: "item.price.invalid", message: "invalid price", references: ["price"] }],
  });
  const stub = (async () =>
    ({ ok: false, status: 400, async text() { return body; } }) as unknown as Response) as unknown as typeof fetch;

  const result = await withFetch(stub, () => runMercadoLivreItemValidation("token", { price: -1 }));
  assert.equal(result.valid, false);
  assert.equal(result.fieldErrors.price, "Campo Preço: o Mercado Livre recusou o preço informado.");
});

test("causas apenas de aviso nao invalidam a publicacao", async () => {
  const body = JSON.stringify({
    message: "validation warnings",
    cause: [{ type: "warning", code: "item.attributes.ignored", message: "Attribute [COLOR] ignored" }],
  });
  const stub = (async () =>
    ({ ok: false, status: 400, async text() { return body; } }) as unknown as Response) as unknown as typeof fetch;

  const result = await withFetch(stub, () => runMercadoLivreItemValidation("token", {}));
  assert.equal(result.valid, true);
  assert.ok(result.warnings.length > 0);
});

test("aviso legado de ME1 nao bloqueia um anuncio ME2", async () => {
  const body = JSON.stringify({ cause: [{ type: "error", message: "user has not mode me1" }] });
  const stub = (async () =>
    ({ ok: false, status: 400, async text() { return body; } }) as unknown as Response) as unknown as typeof fetch;

  const result = await withFetch(stub, () =>
    runMercadoLivreItemValidation("token", { shipping: { mode: "me2" } }),
  );
  assert.equal(result.valid, true);
});

const validationStub = (response: unknown) =>
  (async () =>
    ({ ok: false, status: 400, async text() { return JSON.stringify(response); } }) as unknown as Response) as unknown as typeof fetch;

test("aviso de ME1 junto de outro aviso nao vira recusa num anuncio ME2", async () => {
  // Resposta real de uma publicação válida que a tela descrevia como recusada.
  const stub = validationStub({
    cause: [
      {
        code: "shipping.lost_me1_by_user",
        type: "warning",
        message: "User has not mode me1",
        cause_id: 4053,
        department: "shipping",
        references: ["user.shipping_preferences.modes"],
      },
      {
        code: "item.shipping.mandatory_free_shipping",
        type: "warning",
        message: "Mandatory free shipping added",
        cause_id: 350,
        department: "items",
        references: [],
      },
    ],
    error: "validation_error",
    status: 400,
    message: "Validation error",
  });

  const result = await withFetch(stub, () =>
    runMercadoLivreItemValidation("token", { shipping: { mode: "me2" } }, { shippingMode: "me2" }),
  );
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /não impede a publicação/);
  assert.match(result.warnings[1], /^Frete grátis:/);
  assert.equal(result.warnings.some((warning) => /recus|revise/i.test(warning)), false);
});

test("erro real num anuncio ME2 nao culpa a falta do ME1", async () => {
  const stub = validationStub({
    message: "body.invalid_fields",
    cause: [
      { type: "error", code: "shipping.lost_me1_by_user", message: "User has not mode me1" },
      { type: "error", code: "item.price.invalid", message: "invalid price", references: ["price"] },
    ],
  });

  const result = await withFetch(stub, () =>
    runMercadoLivreItemValidation("token", { shipping: { mode: "me2" } }, { shippingMode: "me2" }),
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ["Campo Preço: o Mercado Livre recusou o preço informado."]);
  assert.deepEqual(Object.keys(result.fieldErrors), ["price"]);
});

test("aviso desconhecido sobre envio nao usa texto de recusa", async () => {
  const stub = validationStub({
    cause: [{ type: "warning", code: "shipping.free_shipping.cost_exceeded", message: "Free shipping cost exceeded" }],
  });

  const result = await withFetch(stub, () =>
    runMercadoLivreItemValidation("token", { shipping: { mode: "me2" } }, { shippingMode: "me2" }),
  );
  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings, ["Aviso do Mercado Livre: Free shipping cost exceeded"]);
});
