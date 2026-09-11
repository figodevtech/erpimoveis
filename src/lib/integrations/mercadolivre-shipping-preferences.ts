import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";
import type { MercadoLivreAccountCredentials } from "@/lib/integrations/mercadolivre-account";
import { getMercadoLivreShippingAddress, type MercadoLivreShippingAddress } from "@/lib/integrations/mercadolivre-address";
import {
  buildMercadoLivreShippingDimensions,
  MERCADO_ENVIOS_MESSAGES,
  MERCADO_ENVIOS_MODE,
  normalize,
  normalizeMe2Restrictions,
  normalizeMercadoEnviosQuote,
  pickMercadoEnviosLogisticType,
  preferencesAllowShippingMode,
  resolveFreeShippingPolicy,
  resolveMercadoEnviosOptions,
  shippingPreferenceLogistics,
  shippingPreferenceModes,
  toQuoteScenario,
  type FreeShippingPolicy,
  type MercadoEnviosLogisticOption,
  type MercadoLivreShippingModesResponse,
  type MercadoLivreShippingPreferences,
  type MercadoLivreShippingQuote,
  type MercadoLivreShippingQuoteScenario,
  type ResolvedMercadoEnviosModes,
} from "@/lib/integrations/mercadolivre-mercado-envios";

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

export type MercadoLivreShippingPreferencesInspection = {
  category: MercadoLivreShippingPreferences | null;
  user: MercadoLivreShippingPreferences | null;
  categoryModes: string[];
  userModes: string[];
  availableModes: string[];
  categoryLogistics: MercadoEnviosLogisticOption[];
  userLogistics: MercadoEnviosLogisticOption[];
  /** Interseção quando existe; caso contrário o que a conta ou a categoria informar. */
  logistics: MercadoEnviosLogisticOption[];
  me2Restricted: boolean;
  me2Restrictions: string[];
  userShippingOption: string | null;
  defaultDimensions: { height?: number; width?: number; length?: number; weight?: number } | null;
};

export async function inspectMercadoLivreShippingPreferences(
  account: MercadoLivreAccountCredentials,
  categoryId: string,
): Promise<MercadoLivreShippingPreferencesInspection> {
  const [category, user] = await Promise.all([
    mercadoLivreApiGet<MercadoLivreShippingPreferences>(
      account.access_token,
      `/categories/${encodeURIComponent(categoryId)}/shipping_preferences`,
    ).catch(() => null),
    mercadoLivreApiGet<MercadoLivreShippingPreferences>(
      account.access_token,
      `/users/${account.ml_user_id}/shipping_preferences`,
    ).catch(() => null),
  ]);

  return buildPreferencesInspection(category, user);
}

export function buildPreferencesInspection(
  category: MercadoLivreShippingPreferences | null,
  user: MercadoLivreShippingPreferences | null,
): MercadoLivreShippingPreferencesInspection {
  const categoryModes = shippingPreferenceModes(category);
  const userModes = shippingPreferenceModes(user);
  const availableModes = categoryModes.length && userModes.length
    ? categoryModes.filter((mode) => userModes.includes(mode))
    : categoryModes.length
      ? categoryModes
      : userModes;

  const categoryLogistics = shippingPreferenceLogistics(category);
  const userLogistics = shippingPreferenceLogistics(user);
  // A categoria devolve os tipos aceitos, a conta devolve os tipos contratados
  // (com `default`). Quando a interseção é vazia, `shipping_modes` ainda pode
  // liberar o anúncio, então nunca devolvemos lista vazia por conta própria.
  const intersection = categoryLogistics.length && userLogistics.length
    ? userLogistics.filter((option) => categoryLogistics.some((entry) => entry.type === option.type))
    : [];
  const logistics = intersection.length ? intersection : userLogistics.length ? userLogistics : categoryLogistics;

  return {
    category,
    user,
    categoryModes,
    userModes,
    availableModes,
    categoryLogistics,
    userLogistics,
    logistics,
    me2Restricted: Boolean(category?.restricted),
    me2Restrictions: normalizeMe2Restrictions(category?.me2_restrictions),
    userShippingOption: user?.option != null ? String(user.option) : null,
    defaultDimensions: category?.dimensions ?? null,
  };
}

/**
 * Pré-checagem barata antes de montar o anúncio.
 *
 * Para Mercado Envios ela nunca recusa: quem decide a disponibilidade do anúncio
 * é `POST /users/{id}/shipping_modes`, chamado logo em seguida. As preferências
 * da conta e da categoria podem não listar `me2` mesmo quando o anúncio é
 * aceito, e recusar aqui deixava o vendedor sem saída — o Mercado Livre exige
 * ME2 justamente para as contas sem o modo legado ME1.
 */
export async function validateMercadoLivreShippingSelection(
  account: MercadoLivreAccountCredentials,
  categoryId: string,
  shippingMode: string,
) {
  const inspection = await inspectMercadoLivreShippingPreferences(account, categoryId);
  const effectiveMode = shippingMode === "pickup" ? "custom" : normalize(shippingMode);
  if (effectiveMode === MERCADO_ENVIOS_MODE) return inspection;

  const check = preferencesAllowShippingMode(effectiveMode, inspection);

  if (check.blockedBy === "category") {
    throw shippingError(
      effectiveMode === MERCADO_ENVIOS_MODE
        ? `${MERCADO_ENVIOS_MESSAGES.categoryUnavailable} Modos retornados para a categoria: ${inspection.categoryModes.join(", ") || "nenhum"}.`
        : `A categoria ${categoryId} não permite o modo de envio selecionado.`,
      { categoryModes: inspection.categoryModes },
    );
  }
  if (check.blockedBy === "seller") {
    throw shippingError(
      effectiveMode === MERCADO_ENVIOS_MODE
        ? `${MERCADO_ENVIOS_MESSAGES.sellerUnavailable} Modos retornados para a conta: ${inspection.userModes.join(", ") || "nenhum"}.`
        : "A conta vendedora não possui envio personalizado ativo.",
      { userModes: inspection.userModes },
    );
  }

  return inspection;
}

export async function fetchMercadoLivreShippingModes(
  account: MercadoLivreAccountCredentials,
  context: MercadoLivreShippingListingContext,
) {
  // O corpo é devolvido junto com a resposta: sem ele não dá para reconstituir
  // depois por que o Mercado Livre recusou o envio deste anúncio.
  const requestBody = {
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
  };

  const response = await fetch(`https://api.mercadolibre.com/users/${account.ml_user_id}/shipping_modes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-multichannel": "true",
      "X-Format-New": "true",
    },
    body: JSON.stringify(requestBody),
    cache: "no-store",
  });

  const text = await response.text();
  let result: MercadoLivreShippingModesResponse & { message?: string; error?: string } = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    // Preserva a resposta bruta abaixo para erros não documentados.
  }

  if (!response.ok) {
    const rawMessage = result.message || result.error || text;
    // O calculador ainda reporta o modo legado ME1 para contas que só têm ME2.
    // Isso não impede a publicação com Mercado Envios.
    if (/user has not mode me1/i.test(String(rawMessage))) {
      return { response: result, requestBody, legacyMe1Warning: true };
    }
    throw shippingError(friendlyShippingModeError(rawMessage), result);
  }

  return { response: result, requestBody, legacyMe1Warning: false };
}

/**
 * Mantém a assinatura usada por `POST /items`: consulta `shipping_modes` e
 * confirma que o modo e a logística escolhidos foram devolvidos pelo Mercado Livre.
 */
export async function validateMercadoLivreShippingForListing(
  account: MercadoLivreAccountCredentials,
  shippingMode: string,
  logisticType: string,
  context: MercadoLivreShippingListingContext,
) {
  const { response, legacyMe1Warning } = await fetchMercadoLivreShippingModes(account, context);
  if (legacyMe1Warning) return response;

  const resolved = resolveMercadoEnviosOptions(response);
  const effectiveMode = shippingMode === "pickup" ? "custom" : normalize(shippingMode);
  if (!resolved.availableModes.includes(effectiveMode)) {
    const availableLabels = resolved.availableModes.join(", ") || "nenhum";
    throw shippingError(
      effectiveMode === MERCADO_ENVIOS_MODE
        ? `${MERCADO_ENVIOS_MESSAGES.categoryUnavailable} Modos retornados pelo Mercado Livre: ${availableLabels}.`
        : `O modo de envio selecionado não está disponível para este anúncio. Modos retornados: ${availableLabels}.`,
      response,
    );
  }

  if (effectiveMode !== MERCADO_ENVIOS_MODE) return response;

  const selectedLogisticType = normalize(logisticType);
  if (!resolved.logistics.some((option) => option.type === selectedLogisticType)) {
    const availableLabels = resolved.logistics.map((option) => option.type).join(", ") || "nenhuma";
    throw shippingError(
      `${MERCADO_ENVIOS_MESSAGES.logisticUnavailable} Opções retornadas: ${availableLabels}.`,
      response,
    );
  }

  return response;
}

/* -------------------------------------------------------------------------- */
/* Cotação do Mercado Envios                                                   */
/* -------------------------------------------------------------------------- */

export type MercadoEnviosQuoteParams = {
  itemPrice: number;
  listingTypeId: string;
  condition: string;
  logisticType: string;
  freeShipping: boolean;
  dimensions: string;
  categoryId?: string | null;
  origin?: MercadoLivreShippingAddress | null;
  keepRaw?: boolean;
};

/**
 * `GET /users/{id}/shipping_options/free`. `dimensions` segue o formato
 * documentado (altura x largura x comprimento, peso em gramas).
 */
export async function quoteMercadoEnvios(
  account: MercadoLivreAccountCredentials,
  params: MercadoEnviosQuoteParams,
): Promise<MercadoLivreShippingQuote> {
  const query = new URLSearchParams({
    dimensions: params.dimensions,
    verbose: "true",
    item_price: String(params.itemPrice),
    listing_type_id: params.listingTypeId,
    mode: MERCADO_ENVIOS_MODE,
    condition: params.condition || "new",
    logistic_type: params.logisticType,
    free_shipping: String(Boolean(params.freeShipping)),
  });
  if (params.categoryId) query.set("category_id", params.categoryId);
  const origin = params.origin ?? null;
  if (origin?.zipCode) query.set("zip_code", origin.zipCode.replace(/\D/g, ""));
  if (origin?.stateId) query.set("state_id", origin.stateId);
  if (origin?.cityId) query.set("city_id", origin.cityId);

  const raw = await mercadoLivreApiGet<unknown>(
    account.access_token,
    `/users/${account.ml_user_id}/shipping_options/free?${query.toString()}`,
  );

  return normalizeMercadoEnviosQuote(raw, {
    freeShipping: Boolean(params.freeShipping),
    logisticType: params.logisticType,
    origin,
    keepRaw: params.keepRaw,
  });
}

/* -------------------------------------------------------------------------- */
/* Resolução completa do Mercado Envios para um anúncio                        */
/* -------------------------------------------------------------------------- */

export type ResolveMercadoEnviosInput = {
  context: MercadoLivreShippingListingContext;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightGrams: number;
  preferredLogisticType?: string | null;
  /** Quando informado, simula apenas este cenário além do padrão. */
  freeShipping?: boolean;
};

export type ResolveMercadoEnviosResult = {
  available: boolean;
  mode: typeof MERCADO_ENVIOS_MODE | null;
  logisticType: string | null;
  logistics: MercadoEnviosLogisticOption[];
  availableModes: string[];
  freeShippingPolicy: FreeShippingPolicy;
  quotes: {
    buyerPaysShipping: MercadoLivreShippingQuoteScenario | null;
    freeShipping: MercadoLivreShippingQuoteScenario | null;
  };
  physicalWeight: number | null;
  billableWeight: number | null;
  origin: MercadoLivreShippingAddress | null;
  preferences: MercadoLivreShippingPreferencesInspection;
  warnings: string[];
  message: string | null;
  /** Guardados para o log de diagnóstico do anúncio. */
  shippingModesRequest: unknown;
  shippingModesResponse: unknown;
};

/**
 * Fluxo oficial: preferências (categoria + conta) → `shipping_modes` do anúncio →
 * logística resolvida → `shipping_options/free` nos dois cenários de frete.
 */
export async function resolveMercadoEnviosForListing(
  account: MercadoLivreAccountCredentials,
  input: ResolveMercadoEnviosInput,
): Promise<ResolveMercadoEnviosResult> {
  const dimensions = buildMercadoLivreShippingDimensions({
    lengthCm: input.lengthCm,
    widthCm: input.widthCm,
    heightCm: input.heightCm,
    weightGrams: input.weightGrams,
  });

  const [preferences, origin] = await Promise.all([
    inspectMercadoLivreShippingPreferences(account, input.context.categoryId),
    getMercadoLivreShippingAddress(account.access_token, account.ml_user_id).catch(() => null),
  ]);

  const warnings: string[] = [];
  let resolved: ResolvedMercadoEnviosModes = {
    availableModes: preferences.availableModes,
    logistics: preferences.logistics,
    available: preferences.availableModes.includes(MERCADO_ENVIOS_MODE) && preferences.logistics.length > 0,
    warnings: [],
  };
  let shippingModesResponse: MercadoLivreShippingModesResponse | null = null;
  let shippingModesRequest: unknown = null;

  if (dimensions) {
    try {
      const { response, requestBody, legacyMe1Warning } = await fetchMercadoLivreShippingModes(account, {
        ...input.context,
        dimensions,
      });
      shippingModesResponse = response;
      shippingModesRequest = requestBody;
      if (legacyMe1Warning) {
        warnings.push(
          "O Mercado Livre respondeu sobre o modo legado ME1. As opções abaixo vieram das preferências da conta e da categoria.",
        );
      } else {
        const fromApi = resolveMercadoEnviosOptions(response);
        warnings.push(...fromApi.warnings);
        // A resposta do anúncio é a fonte de verdade quando devolve logísticas.
        if (fromApi.logistics.length) {
          resolved = fromApi;
        } else {
          resolved = { ...fromApi, logistics: preferences.logistics, available: false };
        }
      }
    } catch (error: any) {
      warnings.push(String(error?.message ?? MERCADO_ENVIOS_MESSAGES.quoteFailed));
    }
  }

  const available = resolved.available && resolved.availableModes.includes(MERCADO_ENVIOS_MODE);
  const logisticType = pickMercadoEnviosLogisticType(resolved.logistics, input.preferredLogisticType);
  const freeShippingPolicy = resolveFreeShippingPolicy({
    mercadoEnviosAvailable: available,
    shippingModes: shippingModesResponse,
    logistics: resolved.logistics,
    userPreferences: preferences.user,
  });

  let buyerPaysShipping: MercadoLivreShippingQuoteScenario | null = null;
  let freeShippingQuote: MercadoLivreShippingQuoteScenario | null = null;
  let billableWeight: number | null = null;

  if (available && logisticType && dimensions) {
    const scenarios: boolean[] =
      freeShippingPolicy === "mandatory" ? [true] : freeShippingPolicy === "unavailable" ? [false] : [false, true];

    const results = await Promise.all(
      scenarios.map(async (freeShipping) => {
        try {
          const quote = await quoteMercadoEnvios(account, {
            itemPrice: input.context.price,
            listingTypeId: input.context.listingTypeId,
            condition: input.context.condition,
            logisticType,
            freeShipping,
            dimensions,
            categoryId: input.context.categoryId,
            origin,
          });
          return { freeShipping, scenario: toQuoteScenario(quote), billableWeight: quote.billableWeight };
        } catch (error: any) {
          return {
            freeShipping,
            scenario: toQuoteScenario(null, friendlyQuoteError(error, origin)),
            billableWeight: null,
          };
        }
      }),
    );

    for (const result of results) {
      if (result.freeShipping) freeShippingQuote = result.scenario;
      else buyerPaysShipping = result.scenario;
      if (billableWeight === null) billableWeight = result.billableWeight;
    }
  }

  return {
    available,
    mode: available ? MERCADO_ENVIOS_MODE : null,
    logisticType,
    logistics: resolved.logistics,
    availableModes: resolved.availableModes,
    freeShippingPolicy,
    quotes: { buyerPaysShipping, freeShipping: freeShippingQuote },
    physicalWeight: Number.isFinite(input.weightGrams) && input.weightGrams > 0 ? Math.round(input.weightGrams) : null,
    billableWeight,
    origin,
    preferences,
    warnings: Array.from(new Set(warnings.filter(Boolean))),
    shippingModesRequest,
    shippingModesResponse,
    message: available
      ? null
      : !dimensions
        ? "Informe comprimento, largura, altura e peso para consultar o Mercado Envios."
        : preferences.userModes.length && !preferences.userModes.includes(MERCADO_ENVIOS_MODE)
          ? MERCADO_ENVIOS_MESSAGES.sellerUnavailable
          : preferences.categoryModes.length && !preferences.categoryModes.includes(MERCADO_ENVIOS_MODE)
            ? MERCADO_ENVIOS_MESSAGES.categoryUnavailable
            : MERCADO_ENVIOS_MESSAGES.quoteFailed,
  };
}

/* -------------------------------------------------------------------------- */
/* Erros                                                                       */
/* -------------------------------------------------------------------------- */

export function friendlyQuoteError(error: any, origin?: MercadoLivreShippingAddress | null) {
  const message = String(error?.message ?? MERCADO_ENVIOS_MESSAGES.quoteFailed);
  if (/PA_UNAUTHORIZED|forbidden|\b403\b/i.test(message)) return MERCADO_ENVIOS_MESSAGES.unauthorized;
  if (!origin?.zipCode && /zip_code|address|origin/i.test(message)) return MERCADO_ENVIOS_MESSAGES.addressMissing;
  if (/dimension|weight|peso/i.test(message)) return MERCADO_ENVIOS_MESSAGES.dimensionsRejected;

  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(message.slice(jsonStart));
      return String(parsed?.message || parsed?.error || MERCADO_ENVIOS_MESSAGES.quoteFailed);
    } catch {
      return MERCADO_ENVIOS_MESSAGES.quoteFailed;
    }
  }
  return message;
}

function friendlyShippingModeError(message: unknown) {
  const value = String(message ?? "").trim();
  if (/dimension/i.test(value)) return MERCADO_ENVIOS_MESSAGES.dimensionsRejected;
  if (/seller|user.*not.*allowed/i.test(value)) return MERCADO_ENVIOS_MESSAGES.sellerUnavailable;
  if (/PA_UNAUTHORIZED|forbidden|\b403\b/i.test(value)) return MERCADO_ENVIOS_MESSAGES.unauthorized;
  return "O Mercado Livre não conseguiu calcular os modos de envio disponíveis para este anúncio. Revise categoria, dimensões, peso e logística.";
}

function shippingError(message: string, validation: unknown) {
  const error = new Error(message);
  (error as any).status = 422;
  (error as any).fieldErrors = { shipping: message };
  (error as any).validation = validation;
  return error;
}
