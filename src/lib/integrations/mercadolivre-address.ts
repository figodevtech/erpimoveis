import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";

export type MercadoLivreShippingAddress = {
  id: string;
  addressLine: string | null;
  zipCode: string | null;
  city: string | null;
  cityId: string | null;
  state: string | null;
  stateId: string | null;
  neighborhood: string | null;
  municipality: string | null;
  country: string | null;
  types: string[];
  normalized: boolean | null;
  status: string | null;
  source: "account_address" | "seller_profile" | "listing";
  partial: boolean;
};

export async function getMercadoLivreShippingAddress(accessToken: string, userId: number | string) {
  const response = await mercadoLivreApiGet<unknown>(
    accessToken,
    `/users/${encodeURIComponent(String(userId))}/addresses`,
  );
  return selectMercadoLivreShippingAddress(response);
}

export function selectMercadoLivreShippingAddress(response: unknown) {
  const addresses = normalizeAddressCollection(response);
  const active = addresses.filter((address) => address.status !== "inactive");
  return (
    active.find((address) => address.types.includes("shipping")) ??
    active.find((address) => address.types.includes("default_selling_address")) ??
    active[0] ??
    null
  );
}

export function selectMercadoLivreShippingAddressSummary(
  response: unknown,
  source: "seller_profile" | "listing",
): MercadoLivreShippingAddress | null {
  const root = asRecord(response);
  const candidate = asRecord(
    source === "listing"
      ? root?.seller_address ?? root?.shipping_address ?? root?.address
      : root?.address ?? root?.seller_address ?? root?.shipping_address,
  );
  if (!candidate) return null;

  const searchLocation = asRecord(candidate.search_location);
  const city = entityValue(candidate.city, "name") ?? entityValue(searchLocation?.city, "name");
  const cityId = entityValue(candidate.city, "id") ?? entityValue(searchLocation?.city, "id");
  const state = entityValue(candidate.state, "name") ?? entityValue(searchLocation?.state, "name");
  const stateId = entityValue(candidate.state, "id") ?? entityValue(searchLocation?.state, "id");
  const country = entityValue(candidate.country, "name") ?? entityValue(searchLocation?.country, "name");
  const zipCode = textOrNull(candidate.zip_code);
  const addressLine = textOrNull(candidate.address_line) ?? textOrNull(candidate.address);

  if (![city, cityId, state, stateId, country, zipCode, addressLine].some(Boolean)) return null;

  return {
    id: textOrNull(candidate.id) ?? "",
    addressLine,
    zipCode,
    city,
    cityId,
    state,
    stateId,
    neighborhood: entityValue(candidate.neighborhood, "name") ?? entityValue(searchLocation?.neighborhood, "name"),
    municipality: entityValue(candidate.municipality, "name") ?? entityValue(searchLocation?.municipality, "name"),
    country,
    types: [],
    normalized: null,
    status: null,
    source,
    partial: true,
  };
}

function normalizeAddressCollection(value: unknown): MercadoLivreShippingAddress[] {
  const source = Array.isArray(value)
    ? value
    : Array.isArray((value as any)?.addresses)
      ? (value as any).addresses
      : value && typeof value === "object" && (value as any)?.id
        ? [value]
        : [];

  return source.map((address: any) => ({
    id: String(address?.id ?? ""),
    addressLine: textOrNull(address?.address_line),
    zipCode: textOrNull(address?.zip_code),
    city: textOrNull(address?.city?.name),
    cityId: textOrNull(address?.city?.id),
    state: textOrNull(address?.state?.name),
    stateId: textOrNull(address?.state?.id),
    neighborhood: textOrNull(address?.neighborhood?.name),
    municipality: textOrNull(address?.municipality?.name),
    country: textOrNull(address?.country?.name),
    types: (Array.isArray(address?.types) ? address.types : []).map((type: unknown) => String(type).toLowerCase()),
    normalized: typeof address?.normalized === "boolean" ? address.normalized : null,
    status: textOrNull(address?.status),
    source: "account_address" as const,
    partial: false,
  }));
}

function entityValue(value: unknown, key: "id" | "name") {
  if (value && typeof value === "object") return textOrNull((value as Record<string, unknown>)[key]);
  return key === "name" ? textOrNull(value) : null;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function textOrNull(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}
