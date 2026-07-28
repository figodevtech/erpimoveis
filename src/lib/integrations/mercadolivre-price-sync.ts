import { supabaseAdmin } from "@/lib/supabaseAdmin";
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

type OutgoingPriceLog = {
  empresaId: number;
  productLinkId: number;
  produtoId: number;
  itemId: string;
  erpPrice: number;
  mlPriceBefore: number | null;
  source?: string;
};

export async function startMercadoLivrePriceSyncLog(params: OutgoingPriceLog) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_price_sync_log")
    .insert({
      empresa_id: params.empresaId,
      product_link_id: params.productLinkId,
      produto_id: params.produtoId,
      ml_item_id: params.itemId,
      direction: "ERP_PARA_ML",
      source: params.source ?? "FILA_ERP",
      status: "PROCESSANDO",
      erp_price_before: params.erpPrice,
      erp_price_after: params.erpPrice,
      ml_price_before: params.mlPriceBefore,
    })
    .select("id")
    .single();
  if (error) {
    console.warn("Não foi possível iniciar o log de preço do Mercado Livre:", error);
    return null;
  }
  return Number(data.id);
}

export async function finishMercadoLivrePriceSyncLog(
  logId: number | null,
  result: { ok: boolean; mlPriceAfter?: number | null; message?: string; details?: Record<string, unknown> },
) {
  if (!logId) return;
  const { error } = await supabaseAdmin
    .from("mercadolivre_price_sync_log")
    .update({
      status: result.ok ? "SUCESSO" : "ERRO",
      ml_price_after: result.mlPriceAfter ?? null,
      message: result.message ?? null,
      details: result.details ?? {},
      completed_at: new Date().toISOString(),
    })
    .eq("id", logId);
  if (error) console.warn("Não foi possível concluir o log de preço do Mercado Livre:", error);
}

export async function applyMercadoLivrePriceToErp(params: {
  productLinkId: number;
  price: number;
  source: string;
  notificationId?: number | null;
  mlPriceBefore?: number | null;
}) {
  const { data, error } = await supabaseAdmin.rpc("fn_aplicar_preco_mercadolivre_no_erp", {
    p_product_link_id: params.productLinkId,
    p_price: params.price,
    p_source: params.source,
    p_notification_id: params.notificationId ?? null,
    p_ml_price_before: params.mlPriceBefore ?? null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data;
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function stringOrNull(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}
