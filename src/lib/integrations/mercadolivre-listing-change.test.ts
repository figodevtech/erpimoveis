import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMercadoLivreEditConfirmations,
  resolveFamilyChange,
  resolveItemMaterialChange,
  resolveStockChange,
} from "@/lib/integrations/mercadolivre-listing-change";

const link = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  title: "Bucha de para-choque",
  status: "active",
  available_quantity: 5,
  raw_item: { status: "active", title: "Bucha de para-choque", available_quantity: 5, _erp_price_state: { standardPrice: 89.9 } },
  ...overrides,
});

test("não vê alteração material quando só campos secundários mudam", () => {
  const change = resolveItemMaterialChange(
    [link()],
    { status: "active", title: "Bucha de para-choque", available_quantity: 5, warranty: "3 meses" },
    { standardPrice: 89.9 },
  );
  assert.equal(change, null);
});

test("reconhece a pausa do anúncio", () => {
  const change = resolveItemMaterialChange(
    [link()],
    { status: "paused", title: "Bucha de para-choque", available_quantity: 5 },
    { standardPrice: 89.9 },
  );
  assert.deepEqual(change?.changes?.status, { before: "active", after: "paused" });
});

test("ignora diferença de preço abaixo de um centavo", () => {
  const igual = resolveItemMaterialChange([link()], { status: "active", title: "Bucha de para-choque" }, { standardPrice: 89.905 });
  assert.equal(igual, null);

  const mudou = resolveItemMaterialChange([link()], { status: "active", title: "Bucha de para-choque" }, { standardPrice: 79.9 });
  assert.deepEqual(mudou?.changes?.price, { before: 89.9, after: 79.9 });
});

test("estoque só é material ao cruzar o zero", () => {
  const parcial = resolveItemMaterialChange(
    [link()],
    { status: "active", title: "Bucha de para-choque", available_quantity: 4 },
    { standardPrice: 89.9 },
  );
  assert.equal(parcial, null);

  const esgotou = resolveItemMaterialChange(
    [link()],
    { status: "active", title: "Bucha de para-choque", available_quantity: 0 },
    { standardPrice: 89.9 },
  );
  assert.deepEqual(esgotou?.changes?.stock, { before: 5, after: 0 });

  const repos = resolveItemMaterialChange(
    [link({ available_quantity: 0, raw_item: { available_quantity: 0, _erp_price_state: { standardPrice: 89.9 } } })],
    { status: "active", title: "Bucha de para-choque", available_quantity: 3 },
    { standardPrice: 89.9 },
  );
  assert.deepEqual(repos?.changes?.stock, { before: 0, after: 3 });
});

test("anúncio ainda sem vínculo no ERP nunca é silenciado", () => {
  const change = resolveItemMaterialChange([], { status: "active" }, { standardPrice: 10 });
  assert.equal(change?.reason, "SEM_VINCULO");
});

test("família calada quando a ressincronização reescreve os mesmos valores", () => {
  const links = [{ family_name: "Buchas Fiat", domain_id: "MLB-CAR_PARTS", catalog_product_id: "MLB999" }];
  assert.equal(resolveFamilyChange(links, { family_name: "Buchas Fiat", domain_id: "MLB-CAR_PARTS" }), null);

  const change = resolveFamilyChange(links, { family_name: "Buchas Fiat Uno" });
  assert.deepEqual(change?.changes?.family_name, { before: "Buchas Fiat", after: "Buchas Fiat Uno" });
});

test("estoque sem variação de quantidade não vira movimento", () => {
  assert.equal(resolveStockChange([{ available_quantity: 7, raw_item: {} }], 7), null);

  const movimento = resolveStockChange([{ ml_item_id: "MLB123", available_quantity: 7, raw_item: {} }], 4);
  assert.equal(movimento?.previousQuantity, 7);
  assert.equal(movimento?.currentQuantity, 4);
  assert.equal(movimento?.delta, -3);
});

const statusByField = (results: Array<{ field: string; status: string }>) =>
  Object.fromEntries(results.map((result) => [result.field, result.status]));

test("edição confirmada quando o Mercado Livre só reformata o texto", () => {
  // Textos reais de uma edição que a tela acusava como aplicada pela metade.
  const results = buildMercadoLivreEditConfirmations(
    {
      familyName: "MÓDULO DO MOTOR  22346792 VOLVO FH D13  — JÁ PROGRAMADO | PRONTA ENTREGA",
      description: "Painel / display Escavadeira  Hyundai, código 21Q6-33401.\n\nPronta  entrega.",
      price: 7250,
    },
    { family_name: "Módulo Do Motor 22346792 Volvo Fh D13  Já Programado | Pronta Entrega" },
    { plain_text: "Painel / display Escavadeira Hyundai, código 21Q6-33401.\n\nPronta entrega." },
    { standardPrice: 7250 },
  );

  assert.deepEqual(statusByField(results), { familyName: "CONFIRMADO", description: "CONFIRMADO", price: "CONFIRMADO" });
});

test("edição divergente quando o Mercado Livre fica com outro conteúdo", () => {
  const results = buildMercadoLivreEditConfirmations(
    { title: "Painel Escavadeira Hyundai Novo", familyName: "Painel Hyundai 21q6-33401 Novo", description: "Peça nova." },
    { title: "Painel Escavadeira Hyundai Usado", family_name: "Painel Hyundai 21q6-33401 Usado" },
    { plain_text: "Peça usada." },
    null,
  );

  assert.deepEqual(statusByField(results), { title: "DIVERGENTE", familyName: "DIVERGENTE", description: "DIVERGENTE" });
});

test("descrição não ignora maiúsculas nem pontuação, só espaços", () => {
  const [description] = buildMercadoLivreEditConfirmations(
    { description: "GARANTIA DE 90 DIAS." },
    {},
    { plain_text: "Garantia de 90 dias" },
    null,
  );
  assert.equal(description.status, "DIVERGENTE");
});

const sellerPackage = (height: string) => [
  { id: "SELLER_PACKAGE_LENGTH", value_name: "26 cm" },
  { id: "SELLER_PACKAGE_WIDTH", value_name: "35 cm" },
  { id: "SELLER_PACKAGE_HEIGHT", value_name: height },
  { id: "SELLER_PACKAGE_WEIGHT", value_name: "463 g" },
];

test("dimensões confirmadas quando o anúncio guarda as medidas do pacote", () => {
  const results = buildMercadoLivreEditConfirmations(
    { lengthCm: 26, widthCm: 35, heightCm: 9, weightGrams: 463, freeShipping: true },
    { attributes: sellerPackage("9 cm"), shipping: { free_shipping: true } },
    null,
    null,
  );

  assert.deepEqual(statusByField(results), {
    freeShipping: "CONFIRMADO",
    lengthCm: "CONFIRMADO",
    widthCm: "CONFIRMADO",
    heightCm: "CONFIRMADO",
    weightGrams: "CONFIRMADO",
  });
});

test("altura que o Mercado Livre não guardou não passa como sucesso", () => {
  // O painel ficou com 90 cm no lugar de 9 cm, e o frete saiu de R$ 50,90 para R$ 151,30.
  const results = buildMercadoLivreEditConfirmations(
    { lengthCm: 26, widthCm: 35, heightCm: 9, weightGrams: 463 },
    { attributes: sellerPackage("90 cm"), shipping: { dimensions: "9x35x26,463" } },
    null,
    null,
  );

  const height = results.find((result) => result.field === "heightCm");
  assert.equal(height?.status, "DIVERGENTE");
  assert.equal(height?.actual, 90);
  assert.equal(results.filter((result) => result.status === "DIVERGENTE").length, 1);
});
