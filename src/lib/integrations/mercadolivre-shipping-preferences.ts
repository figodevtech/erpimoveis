import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";
import type { MercadoLivreAccountCredentials } from "@/lib/integrations/mercadolivre-account";

type ShippingPreferences = {
  modes?: string[];
  logistics?: Array<{ mode?: string; types?: Array<string | { type?: string }> }>;
};

type ShippingModeResponse = {
  channels?: {
    marketplace?: {
      available_modes?: Array<{
        mode?: string;
        logistic_types?: Array<{
          type?: string;
          default?: boolean;
          attributes?: Record<string, unknown>;
        }>;
      }>;
      warnings?: unknown;
    };
  };
};

export type MercadoLivreShippingListingContext = {
  title: string;
  categoryId: string;
  price: number;
  currencyId: string;
  listingTypeId: string;
  condition: string;
  localPickup: boolean;
  dimensions: string | null;
  saleTerms?: unknown[];
  attributes?: unknown[];
};

export async function validateMercadoLivreShippingSelection(
  account: MercadoLivreAccountCredentials,
  categoryId: string,
  shippingMode: string,
  logisticType: string,
) {
  const [categoryPreferences, userPreferences] = await Promise.all([
    mercadoLivreApiGet<ShippingPreferences>(account.access_token, `/categories/${encodeURIComponent(categoryId)}/shipping_preferences`),
    mercadoLivreApiGet<ShippingPreferences>(account.access_token, `/users/${account.ml_user_id}/shipping_preferences`),
  ]);
  const categoryModes = new Set((categoryPreferences.logistics ?? []).map((item) => normalize(item.mode)).filter(Boolean));
  const userModes = new Set([
    ...(userPreferences.modes ?? []).map(normalize),
    ...(userPreferences.logistics ?? []).map((item) => normalize(item.mode)),
  ].filter(Boolean));

  const effectiveMode = shippingMode === "pickup" ? "custom" : normalize(shippingMode);
  if (!categoryModes.has(effectiveMode)) {
    throw new Error(`A categoria ${categoryId} não permite o modo de envio selecionado.`);
  }
  if (!userModes.has(effectiveMode)) {
    throw new Error(`A conta vendedora não possui ${effectiveMode === "me2" ? "Mercado Envios" : "envio personalizado"} ativo.`);
  }

  if (effectiveMode !== "me2") return;
  const selectedLogisticType = normalize(logisticType);
  const categoryTypes = getShippingTypes(categoryPreferences, "me2");
  const userTypes = getShippingTypes(userPreferences, "me2");
  if (categoryTypes.length && !categoryTypes.includes(selectedLogisticType)) {
    throw new Error(`A logística ${logisticType} não está disponível para a categoria ${categoryId}.`);
  }
  if (userTypes.length && !userTypes.includes(selectedLogisticType)) {
    throw new Error(`A logística ${logisticType} não está habilitada para esta conta vendedora.`);
  }
}

export async function validateMercadoLivreShippingForListing(
  account: MercadoLivreAccountCredentials,
  shippingMode: string,
  logisticType: string,
  context: MercadoLivreShippingListingContext,
) {
  const response = await fetch(`https://api.mercadolibre.com/users/${account.ml_user_id}/shipping_modes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-multichannel": "true",
      "X-Format-New": "true",
    },
    body: JSON.stringify({
      buying_mode: "buy_it_now",
      category_id: context.categoryId,
      channels: [{ id: "marketplace" }],
      condition: context.condition,
      dimensions: context.dimensions,
      is_internal: true,
      is_new_listing: true,
      item_currency: context.currencyId,
      item_id: null,
      item_price: context.price,
      listing_type_id: context.listingTypeId,
      local_pick_up: context.localPickup,
      new_format: true,
      sale_terms: context.saleTerms ?? [],
      seller_id: Number(account.ml_user_id),
      site_id: "MLB",
      source: "",
      title: context.title,
      attributes: context.attributes ?? [],
      to_catalog_internal: false,
      to_modes_internal: false,
      traced: false,
      verbose: true,
    }),
    cache: "no-store",
  });

  const text = await response.text();
  let result: ShippingModeResponse & { message?: string; error?: string } = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    // Preserve the raw response below for undocumented errors.
  }

  if (!response.ok) {
    const rawMessage = result.message || result.error || text;
    if (normalize(shippingMode) === "me2" && /user has not mode me1/i.test(String(rawMessage))) {
      return result;
    }

    throw shippingError(friendlyShippingModeError(rawMessage, shippingMode), result);
  }

  const availableModes = result.channels?.marketplace?.available_modes ?? [];
  const effectiveMode = shippingMode === "pickup" ? "custom" : normalize(shippingMode);
  const selectedMode = availableModes.find((option) => normalize(option.mode) === effectiveMode);
  if (!selectedMode) {
    const availableLabels = availableModes.map((option) => normalize(option.mode)).filter(Boolean).join(", ");
    throw shippingError(
      effectiveMode === "me2"
        ? `Mercado Envios não está disponível para este anúncio. Modos retornados pelo Mercado Livre: ${availableLabels || "nenhum"}.`
        : `O modo de envio selecionado não está disponível para este anúncio. Modos retornados: ${availableLabels || "nenhum"}.`,
      result,
    );
  }

  if (effectiveMode !== "me2") return result;

  const selectedLogisticType = normalize(logisticType);
  const availableTypes = selectedMode.logistic_types ?? [];
  const selectedType = availableTypes.find((option) => normalize(option.type) === selectedLogisticType);
  if (!selectedType) {
    const availableLabels = availableTypes.map((option) => normalize(option.type)).filter(Boolean).join(", ");
    throw shippingError(
      `A logística ${logisticType || "selecionada"} não está disponível para este anúncio. Opções retornadas: ${availableLabels || "nenhuma"}.`,
      result,
    );
  }

  return result;
}

function friendlyShippingModeError(message: unknown, requestedMode: string) {
  const value = String(message ?? "").trim();
  if (/user has not mode me1/i.test(value)) {
    return requestedMode === "me2"
      ? "O Mercado Livre tentou aplicar o modo legado ME1, mas a conta não possui esse modo. Revise a logística retornada para este anúncio e mantenha Mercado Envios (ME2)."
      : "A conta vendedora não possui o modo Mercado Envios 1 (ME1). Selecione um modo de envio disponível para esta conta.";
  }
  if (/dimension/i.test(value)) return "O Mercado Livre recusou as dimensões ou o peso informados para este anúncio.";
  if (/seller|user.*not.*allowed/i.test(value)) return "A conta vendedora não está autorizada a usar o modo de envio solicitado.";
  return "O Mercado Livre não conseguiu calcular os modos de envio disponíveis para este anúncio. Revise categoria, dimensões, peso e logística.";
}

function shippingError(message: string, validation: unknown) {
  const error = new Error(message);
  (error as any).status = 422;
  (error as any).fieldErrors = { shipping: message };
  (error as any).validation = validation;
  return error;
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function getShippingTypes(preferences: ShippingPreferences, mode: string) {
  return Array.from(
    new Set(
      (preferences.logistics ?? [])
        .filter((item) => normalize(item.mode) === mode)
        .flatMap((item) => item.types ?? [])
        .map((type) => normalize(typeof type === "string" ? type : type?.type))
        .filter(Boolean),
    ),
  );
}
