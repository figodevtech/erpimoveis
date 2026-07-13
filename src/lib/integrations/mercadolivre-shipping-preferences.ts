import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";
import type { MercadoLivreAccountCredentials } from "@/lib/integrations/mercadolivre-account";

type ShippingPreferences = {
  modes?: string[];
  logistics?: Array<{ mode?: string; types?: Array<string | { type?: string }> }>;
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
