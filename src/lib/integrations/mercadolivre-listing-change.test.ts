import assert from "node:assert/strict";
import test from "node:test";
import {
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
