import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";

export type MercadoLivrePriceState = {
  standardPrice: number | null;
  salePrice: number | null;
  regularPrice: number | null;
  promotionId: string | null;
  promotionType: string | null;
  automationActive: boolean;
  currencyId: string | null;
};

/**
 * Lê o preço do anúncio no Mercado Livre. Esse preço é independente de
 * `produto.precovenda`: nada aqui escreve no cadastro nem envia o preço do ERP.
 */
export async function getMercadoLivrePriceState(
  accessToken: string,
  itemId: string,
  currentItem?: any,
): Promise<MercadoLivrePriceState> {
  const encodedItemId = encodeURIComponent(itemId);
  const [prices, salePrice] = await Promise.all([
    mercadoLivreApiGet<any>(accessToken, `/items/${encodedItemId}/prices`).catch(() => null),
    mercadoLivreApiGet<any>(accessToken, `/items/${encodedItemId}/sale_price?context=channel_marketplace`).catch(() => null),
  ]);
  const entries = Array.isArray(prices?.prices) ? prices.prices : Array.isArray(prices) ? prices : [];
  const standard = entries.find((entry: any) => String(entry?.type ?? "").toLowerCase() === "standard");
  const effectiveAmount = positiveNumber(salePrice?.amount ?? salePrice?.price);
  const regularAmount = positiveNumber(
    salePrice?.regular_amount ?? salePrice?.regular_price ?? salePrice?.metadata?.original_price,
  );
  const fallbackItemPrice = positiveNumber(currentItem?.price);
  const standardAmount = positiveNumber(standard?.amount) ?? regularAmount ?? fallbackItemPrice;
  const tags = Array.isArray(currentItem?.tags) ? currentItem.tags.map((tag: unknown) => String(tag).toLowerCase()) : [];

  return {
    standardPrice: standardAmount,
    salePrice: effectiveAmount ?? standardAmount,
    regularPrice: regularAmount ?? standardAmount,
    promotionId: stringOrNull(salePrice?.promotion_id ?? salePrice?.metadata?.promotion_id),
    promotionType: stringOrNull(salePrice?.promotion_type ?? salePrice?.metadata?.promotion_type),
    automationActive: tags.includes("dynamic_standard_price"),
    currencyId: stringOrNull(salePrice?.currency_id ?? standard?.currency_id ?? currentItem?.currency_id),
  };
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function stringOrNull(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}
