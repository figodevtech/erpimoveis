export type MercadoLivrePackageAttribute = {
  id: "SELLER_PACKAGE_LENGTH" | "SELLER_PACKAGE_WIDTH" | "SELLER_PACKAGE_HEIGHT" | "SELLER_PACKAGE_WEIGHT";
  value_name: string;
};

const ENABLED_MERCADO_LIVRE_LISTING_TYPES = new Set(["gold_special", "gold_pro"]);

export function isMercadoLivreListingTypeEnabled(listingTypeId: string | null | undefined) {
  return ENABLED_MERCADO_LIVRE_LISTING_TYPES.has(String(listingTypeId ?? "").trim().toLowerCase());
}

export const disabledMercadoLivreListingTypeMessage = "Esta modalidade de anúncio está desabilitada. Selecione Clássico ou Premium.";

export function buildMercadoLivrePackageAttributes(params: {
  shippingMode: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightGrams: number;
}): MercadoLivrePackageAttribute[] {
  if (params.shippingMode.toLowerCase() !== "me2") return [];
  if (![params.lengthCm, params.widthCm, params.heightCm].every((value) => Number.isFinite(value) && value > 0)) return [];
  if (!Number.isInteger(params.weightGrams) || params.weightGrams <= 0) return [];

  return [
    { id: "SELLER_PACKAGE_LENGTH", value_name: `${formatMeasurement(params.lengthCm)} cm` },
    { id: "SELLER_PACKAGE_WIDTH", value_name: `${formatMeasurement(params.widthCm)} cm` },
    { id: "SELLER_PACKAGE_HEIGHT", value_name: `${formatMeasurement(params.heightCm)} cm` },
    { id: "SELLER_PACKAGE_WEIGHT", value_name: `${params.weightGrams} g` },
  ];
}

export function hasOnlyMercadoLivreValidationWarnings(validation: unknown) {
  if (!validation || typeof validation !== "object") return false;

  const value = validation as Record<string, unknown>;
  const causes = [
    ...(Array.isArray(value.cause) ? value.cause : []),
    ...(Array.isArray(value.cause_list) ? value.cause_list : []),
  ];
  if (!causes.length) return false;

  return causes.every((cause) => {
    if (!cause || typeof cause !== "object") return false;
    return String((cause as Record<string, unknown>).type ?? "").toLowerCase() === "warning";
  });
}

export function resolveMercadoLivreDefaultListingType(preferred: string | null | undefined, availableIds: string[]) {
  const available = new Set(availableIds);
  if (preferred && available.has(preferred)) return preferred;
  if (available.has("gold_special")) return "gold_special";
  return availableIds[0] ?? null;
}

function formatMeasurement(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace(",", ".");
}
