/**
 * Diferenças entre o que o ERP conhece de um anúncio e o que o Mercado Livre
 * acabou de informar. Módulo puro, sem acesso a banco, para poder ser testado.
 */

/**
 * O tópico `items` dispara a qualquer mudança de campo do anúncio — garantia,
 * atributo, foto, frete. Avisar em todas transforma a central num ruído que
 * ninguém lê. Só quatro coisas justificam interromper alguém: o anúncio mudou de
 * situação, o preço mudou, o estoque esgotou (ou voltou) e o título mudou.
 */
export function resolveItemMaterialChange(links: any[], item: any, priceState: { standardPrice: number | null }) {
  const link = links[0] ?? null;
  // Sem vínculo não há estado anterior para comparar; tratar como material
  // preserva o aviso de um anúncio que o ERP ainda não conhece.
  if (!link) return { reason: "SEM_VINCULO" as const };

  const previousItem = link.raw_item ?? {};
  const changes: Record<string, { before: unknown; after: unknown }> = {};

  const statusBefore = clean(link.status ?? previousItem?.status);
  const statusAfter = clean(item?.status);
  if (statusAfter && statusBefore !== statusAfter) changes.status = { before: statusBefore, after: statusAfter };

  const priceBefore = finitePrice(previousItem?._erp_price_state?.standardPrice ?? previousItem?.price);
  const priceAfter = finitePrice(priceState.standardPrice ?? item?.price);
  if (priceAfter != null && (priceBefore == null || Math.abs(priceBefore - priceAfter) >= 0.01)) {
    changes.price = { before: priceBefore, after: priceAfter };
  }

  const titleBefore = clean(link.title ?? previousItem?.title);
  const titleAfter = clean(item?.title);
  if (titleAfter && titleBefore !== titleAfter) changes.title = { before: titleBefore, after: titleAfter };

  // Variação de estoque só interessa quando cruza o zero: esgotar tira o anúncio
  // do ar e repor devolve. As unidades intermediárias mudam a cada venda.
  const stockBefore = finiteStockQuantity(previousItem?.available_quantity ?? link.available_quantity);
  const stockAfter = finiteStockQuantity(item?.available_quantity);
  if (stockBefore != null && stockAfter != null && stockBefore !== stockAfter) {
    if (stockAfter === 0 || stockBefore === 0) changes.stock = { before: stockBefore, after: stockAfter };
  }

  if (!Object.keys(changes).length) return null;
  return { reason: "ALTERACAO" as const, changes };
}

/**
 * Família só é material quando muda o que aparece para o comprador ou o vínculo
 * de catálogo. Uma ressincronização que reescreve os mesmos valores fica calada.
 */
export function resolveFamilyChange(links: any[], updates: Record<string, unknown>) {
  const fields = ["family_name", "domain_id", "catalog_product_id"] as const;
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const field of fields) {
    if (!(field in updates)) continue;
    const after = clean(updates[field]);
    if (!after) continue;
    const changed = (links ?? []).some((link) => clean(link?.[field]) !== after);
    if (changed) changes[field] = { before: clean(links[0]?.[field]), after };
  }
  return Object.keys(changes).length ? { reason: "ALTERACAO" as const, changes } : null;
}

function finitePrice(value: unknown) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function clean(value: unknown) {
  if (value == null) return null;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized || null;
}

export function resolveStockChange(links: any[], currentQuantityValue: unknown) {
  const currentQuantity = finiteStockQuantity(currentQuantityValue);
  if (currentQuantity == null) return null;

  const link = links[0] ?? null;
  const synchronized = link?.raw_item?._erp_stock_sync;
  const synchronizedAt = Date.parse(String(synchronized?.synchronizedAt ?? ""));
  const recentSynchronization = Number.isFinite(synchronizedAt) && Date.now() - synchronizedAt <= 60 * 60_000;
  const synchronizedCurrent = finiteStockQuantity(synchronized?.currentQuantity);
  const storedPrevious = finiteStockQuantity(link?.available_quantity);
  const previousQuantity =
    recentSynchronization && synchronizedCurrent === currentQuantity
      ? finiteStockQuantity(synchronized?.previousQuantity)
      : storedPrevious;
  const product = Array.isArray(link?.produto) ? link.produto[0] : link?.produto;
  if (previousQuantity == null || previousQuantity === currentQuantity) return null;

  return {
    previousQuantity,
    currentQuantity,
    delta: previousQuantity == null ? null : currentQuantity - previousQuantity,
    itemId: link?.ml_item_id ?? link?.raw_item?.id ?? null,
    itemTitle: link?.title ?? product?.tituloMarketplace ?? product?.titulo ?? null,
  };
}

export function finiteStockQuantity(value: unknown) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? Math.trunc(quantity) : null;
}

export function getUserProductAvailableQuantity(stock: any) {
  const direct = Number(stock?.available_quantity ?? stock?.quantity);
  if (Number.isFinite(direct) && direct >= 0) return Math.trunc(direct);

  const locations = Array.isArray(stock?.locations) ? stock.locations : [];
  if (!locations.length) return null;
  return locations.reduce((total: number, location: any) => {
    const quantity = Number(location?.available_quantity ?? location?.quantity ?? 0);
    return total + (Number.isFinite(quantity) && quantity > 0 ? Math.trunc(quantity) : 0);
  }, 0);
}
