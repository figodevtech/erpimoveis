import type { MercadoLivreShippingAddress } from "@/lib/integrations/mercadolivre-address";

/**
 * Modelo único do Mercado Envios 2 usado pelo ERP.
 *
 * Fontes oficiais consultadas (Mercado Livre Developers):
 * - Mercado Envios 2: GET /categories/{id}/shipping_preferences, GET /users/{id}/shipping_preferences,
 *   POST /users/{id}/shipping_modes e o payload `shipping` aceito em POST /items.
 * - Custos de envio: GET /users/{id}/shipping_options/free.
 * - Custos por vender: GET /sites/{site}/listing_prices.
 */

export const MERCADO_ENVIOS_MODE = "me2" as const;

export type MercadoEnviosLogisticOption = {
  type: string;
  default: boolean;
  attributes: Record<string, unknown>;
};

export type FreeShippingPolicy = "mandatory" | "optional" | "unavailable" | "unknown";

export type MercadoLivreShippingDimensionsInput = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightGrams: number;
};

export type MercadoLivreShippingQuote = {
  currencyId: string;
  sellerShippingCost: number | null;
  billableWeight: number | null;
  freeShipping: boolean;
  logisticType: string;
  origin: MercadoLivreShippingAddress | null;
  /** Valor antes do desconto promocional, quando o Mercado Livre informa `coverage.discount`. */
  listCostBeforeDiscount: number | null;
  discountRate: number | null;
  raw?: unknown;
};

export type MercadoLivreShippingQuoteScenario = {
  available: boolean;
  freeShipping: boolean;
  sellerShippingCost: number | null;
  currencyId: string;
  billableWeight: number | null;
  error: string | null;
};

export type MercadoLivreShippingQuotes = {
  buyerPaysShipping: MercadoLivreShippingQuoteScenario | null;
  freeShipping: MercadoLivreShippingQuoteScenario | null;
};

export type MercadoLivreShippingValidation = {
  available: boolean;
  mode: typeof MERCADO_ENVIOS_MODE | null;
  logisticType: string | null;
  logistics: MercadoEnviosLogisticOption[];
  freeShippingPolicy: FreeShippingPolicy;
  quotes: MercadoLivreShippingQuotes;
  physicalWeight: number | null;
  billableWeight: number | null;
};

export type MercadoLivreShippingPreferences = {
  modes?: unknown;
  option?: unknown;
  restricted?: unknown;
  me2_restrictions?: unknown;
  dimensions?: { height?: number; width?: number; length?: number; weight?: number } | null;
  free_configurations?: unknown;
  logistics?: unknown;
};

export type MercadoLivreShippingModesResponse = {
  channels?: {
    marketplace?: {
      available_modes?: unknown;
      warnings?: unknown;
    };
  };
};

/* -------------------------------------------------------------------------- */
/* Dimensões                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Formato documentado por `shipping_options/free` e por `shipping_modes`:
 * `altura x largura x comprimento, peso` — centímetros e peso em gramas.
 * Centralizado para que os dois endpoints nunca usem ordens diferentes.
 */
export function buildMercadoLivreShippingDimensions(params: MercadoLivreShippingDimensionsInput) {
  const { lengthCm, widthCm, heightCm, weightGrams } = params;
  if (![lengthCm, widthCm, heightCm].every((value) => Number.isFinite(value) && value > 0)) return null;
  if (!Number.isFinite(weightGrams) || weightGrams <= 0) return null;
  const weight = Math.round(weightGrams);
  return `${measurement(heightCm)}x${measurement(widthCm)}x${measurement(lengthCm)},${weight}`;
}

/** Lê `altura x largura x comprimento, peso` no mesmo formato produzido acima. */
export function parseMercadoLivreShippingDimensions(value: unknown) {
  const match = String(value ?? "").trim().match(/^([\d.,]+)\s*x\s*([\d.,]+)\s*x\s*([\d.,]+)\s*,\s*([\d.,]+)$/i);
  if (!match) return null;
  const heightCm = positiveNumber(match[1]);
  const widthCm = positiveNumber(match[2]);
  const lengthCm = positiveNumber(match[3]);
  const weightGrams = positiveNumber(match[4]);
  if (!heightCm || !widthCm || !lengthCm || !weightGrams) return null;
  return { heightCm, widthCm, lengthCm, weightGrams };
}

function measurement(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/* -------------------------------------------------------------------------- */
/* Preferências de envio (categoria e vendedor)                                */
/* -------------------------------------------------------------------------- */

/**
 * `types` chega como array de strings em `/categories/{id}/shipping_preferences`
 * e como array de objetos `{ type, default, ... }` em `/users/{id}/shipping_preferences`.
 */
export function normalizeMercadoEnviosLogisticOptions(types: unknown): MercadoEnviosLogisticOption[] {
  if (!Array.isArray(types)) return [];
  const result = new Map<string, MercadoEnviosLogisticOption>();
  for (const entry of types) {
    if (typeof entry === "string") {
      const type = normalize(entry);
      if (type && !result.has(type)) result.set(type, { type, default: false, attributes: {} });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const type = normalize(record.type);
    if (!type) continue;
    const { type: _type, default: isDefault, ...attributes } = record;
    void _type;
    const existing = result.get(type);
    result.set(type, {
      type,
      default: Boolean(isDefault) || Boolean(existing?.default),
      attributes: { ...(existing?.attributes ?? {}), ...attributes },
    });
  }
  return Array.from(result.values());
}

export function shippingPreferenceModes(preferences: MercadoLivreShippingPreferences | null | undefined) {
  if (!preferences) return [];
  const fromModes = Array.isArray(preferences.modes) ? preferences.modes.map(normalize) : [];
  const fromLogistics = Array.isArray(preferences.logistics)
    ? preferences.logistics.map((entry) => normalize((entry as Record<string, unknown> | null)?.mode))
    : [];
  return unique([...fromModes, ...fromLogistics]);
}

export function shippingPreferenceLogistics(
  preferences: MercadoLivreShippingPreferences | null | undefined,
  mode: string = MERCADO_ENVIOS_MODE,
): MercadoEnviosLogisticOption[] {
  if (!preferences || !Array.isArray(preferences.logistics)) return [];
  const target = normalize(mode);
  const merged: unknown[] = [];
  for (const entry of preferences.logistics) {
    const record = entry as Record<string, unknown> | null;
    if (!record || normalize(record.mode) !== target) continue;
    if (Array.isArray(record.types)) merged.push(...record.types);
  }
  return normalizeMercadoEnviosLogisticOptions(merged);
}

/**
 * Uma lista de modos vazia significa que o Mercado Livre não informou aquele
 * lado — não que o modo esteja proibido. Só negamos quando a categoria ou a
 * conta responderam e o modo não veio entre os retornados. O veredito final é
 * de `POST /users/{id}/shipping_modes` para o anúncio específico.
 *
 * Usada pela tela (habilitar a opção) e pela API (recusar a publicação) para
 * que as duas nunca discordem.
 */
export function preferencesAllowShippingMode(
  mode: string,
  preferences: { categoryModes: string[]; userModes: string[] },
): { allowed: boolean; blockedBy: "category" | "seller" | null } {
  const target = normalize(mode);
  const categoryModes = preferences.categoryModes.map(normalize);
  const userModes = preferences.userModes.map(normalize);

  if (categoryModes.length && !categoryModes.includes(target)) return { allowed: false, blockedBy: "category" };
  if (userModes.length && !userModes.includes(target)) return { allowed: false, blockedBy: "seller" };
  return { allowed: true, blockedBy: null };
}

export function normalizeMe2Restrictions(value: unknown) {
  if (Array.isArray(value)) return value.map((entry) => String(entry)).filter(Boolean);
  const text = String(value ?? "").trim();
  return text ? [text] : [];
}

/* -------------------------------------------------------------------------- */
/* shipping_modes — fonte de verdade do anúncio                                */
/* -------------------------------------------------------------------------- */

export type ResolvedMercadoEnviosModes = {
  availableModes: string[];
  logistics: MercadoEnviosLogisticOption[];
  available: boolean;
  warnings: string[];
};

/**
 * Normaliza a resposta de `POST /users/{id}/shipping_modes`, que é a fonte de
 * verdade sobre quais modos e logísticas existem para aquele anúncio específico.
 */
export function resolveMercadoEnviosOptions(response: MercadoLivreShippingModesResponse | null | undefined): ResolvedMercadoEnviosModes {
  const marketplace = response?.channels?.marketplace;
  const rawModes = Array.isArray(marketplace?.available_modes) ? marketplace?.available_modes ?? [] : [];
  const availableModes = unique(
    rawModes.map((entry) => normalize((entry as Record<string, unknown> | null)?.mode)),
  );
  const me2 = rawModes.find((entry) => normalize((entry as Record<string, unknown> | null)?.mode) === MERCADO_ENVIOS_MODE) as
    | Record<string, unknown>
    | undefined;
  const logistics = normalizeMercadoEnviosLogisticOptions(me2?.logistic_types);

  return {
    availableModes,
    logistics,
    available: Boolean(me2) && logistics.length > 0,
    warnings: normalizeWarnings(marketplace?.warnings),
  };
}

/** Usa o tipo marcado como `default = true`; senão respeita a preferência atual; senão o primeiro retornado. */
export function pickMercadoEnviosLogisticType(
  logistics: MercadoEnviosLogisticOption[],
  preferred?: string | null,
): string | null {
  if (!logistics.length) return null;
  const wanted = normalize(preferred);
  const byDefault = logistics.find((option) => option.default);
  if (byDefault) return byDefault.type;
  if (wanted && logistics.some((option) => option.type === wanted)) return wanted;
  return logistics[0].type;
}

function normalizeWarnings(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          const record = entry as Record<string, unknown>;
          return String(record.message ?? record.description ?? record.code ?? "");
        }
        return "";
      })
      .filter(Boolean);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const message = String(record.message ?? record.description ?? record.code ?? "");
    return message ? [message] : [];
  }
  return [];
}

/* -------------------------------------------------------------------------- */
/* Cotação — shipping_options/free                                             */
/* -------------------------------------------------------------------------- */

export type NormalizeQuoteContext = {
  freeShipping: boolean;
  logisticType: string;
  origin?: MercadoLivreShippingAddress | null;
  keepRaw?: boolean;
};

/**
 * A documentação de `GET /users/{id}/shipping_options/free` define exclusivamente
 * `coverage.all_country.{list_cost,currency_id,billable_weight}` e, quando houver
 * promoção, `coverage.discount`. Não existem `quote.cost`, `quote.seller.cost`
 * nem `coverage.cost`: ler esses campos sempre devolvia `null`.
 */
export function normalizeMercadoEnviosQuote(raw: unknown, context: NormalizeQuoteContext): MercadoLivreShippingQuote {
  const coverage = asRecord(asRecord(raw)?.coverage);
  const allCountry = asRecord(coverage?.all_country);
  const discount = asRecord(coverage?.discount);
  const listCost = numberOrNull(allCountry?.list_cost);
  const promotedAmount = numberOrNull(discount?.promoted_amount);
  const discountRate = numberOrNull(discount?.rate);

  return {
    currencyId: String(allCountry?.currency_id ?? "BRL") || "BRL",
    sellerShippingCost: listCost,
    billableWeight: numberOrNull(allCountry?.billable_weight),
    freeShipping: context.freeShipping,
    logisticType: normalize(context.logisticType),
    origin: context.origin ?? null,
    listCostBeforeDiscount: promotedAmount && promotedAmount > 0 ? promotedAmount : null,
    discountRate: discountRate,
    ...(context.keepRaw ? { raw } : {}),
  };
}

export function toQuoteScenario(
  quote: MercadoLivreShippingQuote | null,
  error: string | null = null,
): MercadoLivreShippingQuoteScenario {
  if (!quote) {
    return {
      available: false,
      freeShipping: false,
      sellerShippingCost: null,
      currencyId: "BRL",
      billableWeight: null,
      error,
    };
  }
  return {
    available: quote.sellerShippingCost !== null,
    freeShipping: quote.freeShipping,
    sellerShippingCost: quote.sellerShippingCost,
    currencyId: quote.currencyId,
    billableWeight: quote.billableWeight,
    error,
  };
}

/* -------------------------------------------------------------------------- */
/* Política de frete grátis                                                    */
/* -------------------------------------------------------------------------- */

export type FreeShippingPolicyInput = {
  mercadoEnviosAvailable: boolean;
  shippingModes?: unknown;
  logistics?: MercadoEnviosLogisticOption[];
  userPreferences?: MercadoLivreShippingPreferences | null;
  itemShipping?: unknown;
  itemTags?: unknown;
};

/**
 * Só declara `mandatory` quando o Mercado Livre marca `mandatory_free_shipping`.
 * O ERP não deduz obrigatoriedade a partir do preço.
 */
export function resolveFreeShippingPolicy(input: FreeShippingPolicyInput): FreeShippingPolicy {
  if (hasMandatoryFreeShippingFlag(input.itemShipping) || containsMandatoryFreeShippingTag(input.itemTags)) {
    return "mandatory";
  }
  if (input.logistics?.some((option) => truthyFlag(option.attributes?.mandatory_free_shipping))) return "mandatory";
  if (hasMandatoryFreeShippingFlag(input.shippingModes)) return "mandatory";
  if (!input.mercadoEnviosAvailable) return "unavailable";
  if (Array.isArray(input.userPreferences?.free_configurations)) return "optional";
  return "unknown";
}

function containsMandatoryFreeShippingTag(tags: unknown) {
  if (!Array.isArray(tags)) return false;
  return tags.some((tag) => normalize(tag) === "mandatory_free_shipping");
}

function hasMandatoryFreeShippingFlag(value: unknown, depth = 0): boolean {
  if (depth > 6 || !value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((entry) => hasMandatoryFreeShippingFlag(entry, depth + 1));
  const record = value as Record<string, unknown>;
  if (truthyFlag(record.mandatory_free_shipping)) return true;
  if (containsMandatoryFreeShippingTag(record.tags)) return true;
  return Object.values(record).some((entry) => hasMandatoryFreeShippingFlag(entry, depth + 1));
}

function truthyFlag(value: unknown) {
  return value === true || normalize(value) === "true";
}

/* -------------------------------------------------------------------------- */
/* Custos do anúncio                                                           */
/* -------------------------------------------------------------------------- */

export type MercadoLivreListingCostsInput = {
  price: number;
  /** `sale_fee_amount` de `/sites/{site}/listing_prices` — já é o custo total por vender. */
  saleFeeAmount: number | null;
  /** `sale_fee_details.fixed_fee` — detalhamento, já incluso em `saleFeeAmount`. */
  fixedFee?: number | null;
  percentageFee?: number | null;
  financingFee?: number | null;
  listingFeeAmount?: number | null;
  sellerShippingCost?: number | null;
};

export type MercadoLivreListingCosts = {
  price: number;
  /** Igual a `sale_fee_amount`: a taxa fixa NÃO é somada novamente. */
  marketplaceCost: number | null;
  fixedFee: number | null;
  percentageFee: number | null;
  financingFee: number | null;
  listingFeeAmount: number | null;
  sellerShippingCost: number | null;
  estimatedNetAmount: number | null;
};

/**
 * `sale_fee_amount` é o custo total por vender e já contém `sale_fee_details.fixed_fee`.
 * Somar a taxa fixa outra vez cobraria o mesmo valor duas vezes no resumo.
 */
export function computeMercadoLivreListingCosts(input: MercadoLivreListingCostsInput): MercadoLivreListingCosts {
  const price = Number.isFinite(input.price) ? input.price : 0;
  const marketplaceCost = numberOrNull(input.saleFeeAmount);
  const sellerShippingCost = numberOrNull(input.sellerShippingCost);
  const listingFeeAmount = numberOrNull(input.listingFeeAmount);
  const estimatedNetAmount =
    marketplaceCost === null
      ? null
      : round2(price - marketplaceCost - (sellerShippingCost ?? 0) - (listingFeeAmount ?? 0));

  return {
    price,
    marketplaceCost,
    fixedFee: numberOrNull(input.fixedFee),
    percentageFee: numberOrNull(input.percentageFee),
    financingFee: numberOrNull(input.financingFee),
    listingFeeAmount,
    sellerShippingCost,
    estimatedNetAmount,
  };
}

/* -------------------------------------------------------------------------- */
/* Verificação pós-publicação                                                  */
/* -------------------------------------------------------------------------- */

export type MercadoEnviosVerification = {
  ok: boolean;
  mode: string;
  logisticType: string;
  localPickup: boolean;
  freeShipping: boolean;
  /** `true` quando a logística aplicada difere da prevista mas continua sendo ME2 válida. */
  logisticMismatch: boolean;
  expectedLogisticType: string | null;
  reasons: string[];
};

const KNOWN_ME2_LOGISTIC_TYPES = new Set([
  "drop_off",
  "xd_drop_off",
  "cross_docking",
  "self_service",
  "fulfillment",
  "turbo",
]);

/**
 * Confirma `shipping.mode === "me2"`, presença de `logistic_type` e ausência de
 * retirada local. Uma logística diferente da prevista, mas válida em ME2, é
 * registrada como divergência e não invalida a publicação.
 */
export function verifyMercadoEnviosItem(
  item: unknown,
  options: { expectedLogisticType?: string | null; expectedFreeShipping?: boolean | null } = {},
): MercadoEnviosVerification {
  const shipping = asRecord(asRecord(item)?.shipping) ?? {};
  const mode = normalize(shipping.mode);
  const logisticType = normalize(shipping.logistic_type);
  const localPickup = shipping.local_pick_up === true;
  const freeShipping = shipping.free_shipping === true;
  const expectedLogisticType = normalize(options.expectedLogisticType) || null;
  const reasons: string[] = [];

  if (mode !== MERCADO_ENVIOS_MODE) {
    reasons.push(`Modo retornado: ${mode || "não informado"}.`);
  }
  if (!logisticType) {
    reasons.push("Nenhuma logística operacional foi retornada.");
  }
  if (localPickup) {
    reasons.push("Retirada local veio habilitada.");
  }

  const logisticMismatch = Boolean(
    expectedLogisticType && logisticType && logisticType !== expectedLogisticType && isMercadoEnviosLogisticType(logisticType),
  );
  if (
    expectedLogisticType &&
    logisticType &&
    logisticType !== expectedLogisticType &&
    !isMercadoEnviosLogisticType(logisticType)
  ) {
    reasons.push(`Logística retornada (${logisticType}) não é uma logística válida do Mercado Envios.`);
  }
  if (options.expectedFreeShipping != null && freeShipping !== options.expectedFreeShipping) {
    reasons.push(
      options.expectedFreeShipping
        ? "O anúncio foi criado sem frete grátis, embora o cenário selecionado fosse frete grátis."
        : "O anúncio foi criado com frete grátis, embora o cenário selecionado fosse frete pago pelo comprador.",
    );
  }

  return {
    ok: mode === MERCADO_ENVIOS_MODE && Boolean(logisticType) && !localPickup,
    mode,
    logisticType,
    localPickup,
    freeShipping,
    logisticMismatch,
    expectedLogisticType,
    reasons,
  };
}

export function isMercadoEnviosLogisticType(value: unknown) {
  return KNOWN_ME2_LOGISTIC_TYPES.has(normalize(value));
}

/* -------------------------------------------------------------------------- */
/* Rótulos e mensagens                                                         */
/* -------------------------------------------------------------------------- */

const LOGISTIC_LABELS: Record<string, string> = {
  drop_off: "Agência / ponto de despacho",
  xd_drop_off: "Coletas e Places",
  cross_docking: "Coleta / Cross Docking",
  self_service: "Mercado Envios Flex",
  fulfillment: "Mercado Envios Full",
  turbo: "Mercado Envios Turbo",
};

/** Apenas rótulo amigável: o código real continua sendo o que trafega na API. */
export function mercadoEnviosLogisticLabel(type: unknown) {
  const normalized = normalize(type);
  if (!normalized) return "Não definida";
  return LOGISTIC_LABELS[normalized] ?? normalized;
}

export const MERCADO_ENVIOS_MESSAGES = {
  categoryUnavailable: "Mercado Envios não está disponível para esta categoria.",
  sellerUnavailable: "A conta vendedora não possui Mercado Envios habilitado.",
  logisticUnavailable: "A logística selecionada não está disponível para este anúncio.",
  dimensionsRejected: "O Mercado Livre recusou as dimensões ou o peso informado.",
  quoteFailed: "Não foi possível calcular o custo do Mercado Envios.",
  mandatoryFreeShipping: "O Mercado Livre exige frete grátis para este anúncio.",
  addressMissing:
    "Não foi possível calcular o Mercado Envios com o endereço de origem atual da conta. Revise o endereço de envio no Mercado Livre.",
  listingInvalid: "A publicação possui campos que precisam ser corrigidos antes do envio.",
  unauthorized: "A conta conectada não tem permissão para consultar o Mercado Envios. Reconecte a conta Mercado Livre.",
} as const;

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                  */
/* -------------------------------------------------------------------------- */

export function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value: unknown) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
