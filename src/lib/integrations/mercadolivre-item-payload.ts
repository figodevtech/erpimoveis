import {
  buildMercadoLivrePackageAttributes,
  disabledMercadoLivreListingTypeMessage,
  hasOnlyMercadoLivreValidationWarnings,
  isMercadoLivreListingTypeEnabled,
} from "@/lib/integrations/mercadolivre-listing-validation";
import { buildMercadoLivreShippingDimensions } from "@/lib/integrations/mercadolivre-mercado-envios";

/**
 * Montagem do payload de `POST /items` e da validação oficial em `POST /items/validate`.
 * Compartilhado pela criação e pela etapa "Validar anúncio" para que os dois enviem
 * exatamente a mesma estrutura ao Mercado Livre.
 */

export type MercadoLivreAttributeDefinition = {
  id?: string;
  name?: string;
  valueType?: string;
  required?: boolean;
  values?: Array<{ id?: string; name?: string }>;
  allowedUnits?: Array<{ id?: string; name?: string }>;
  defaultUnit?: string | null;
};

export type MercadoLivreAttributePayload = {
  id: string;
  value_id?: string;
  value_name?: string;
  value_struct?: { number: number; unit: string };
};

export type BuildMercadoLivreItemPayloadInput = {
  title: string;
  categoryId: string;
  price: number;
  availableQuantity: number;
  condition: string;
  listingTypeId: string;
  pictures: Array<{ source?: string; id?: string }>;
  brand: string;
  model: string;
  partNumber: string;
  familyName: string;
  gtin: string;
  sku: string;
  warranty: string;
  warrantyTime: string;
  dynamicAttributes: Record<string, unknown>;
  attributeDefinitions: MercadoLivreAttributeDefinition[];
  userProductSeller: boolean;
  shippingMode: string;
  freeShipping: boolean;
  localPickup: boolean;
  customShippingDescription?: string;
  customShippingCost?: number;
  customShippingDeadlineDays?: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightGrams: number;
};

export type BuiltMercadoLivreItemPayload = {
  payload: Record<string, unknown>;
  attributes: MercadoLivreAttributePayload[];
  saleTerms: Array<Record<string, unknown>>;
};

export type MercadoLivreListingRequest = ReturnType<typeof parseMercadoLivreListingRequest>;

/** Leitura única do corpo enviado pelo formulário, usada por criar e por validar. */
export function parseMercadoLivreListingRequest(body: any) {
  return {
    produtoId: Number(body?.produtoId),
    title: String(body?.title ?? "").trim(),
    categoryId: String(body?.categoryId ?? "").trim().toUpperCase(),
    description: String(body?.description ?? "").trim(),
    price: Number(body?.price),
    availableQuantity: Math.trunc(Number(body?.availableQuantity)),
    condition: String(body?.condition ?? "new").trim().toLowerCase(),
    listingTypeId: String(body?.listingTypeId ?? "gold_special").trim(),
    pictureUrl: String(body?.pictureUrl ?? "").trim(),
    brand: String(body?.brand ?? "").trim(),
    model: String(body?.model ?? "").trim(),
    partNumber: String(body?.partNumber ?? "").trim(),
    familyName: String(body?.familyName ?? "").trim(),
    gtin: String(body?.gtin ?? "").trim(),
    sku: String(body?.sku ?? "").trim(),
    warranty: String(body?.warranty ?? "").trim(),
    warrantyTime: String(body?.warrantyTime ?? "").trim(),
    dynamicAttributes:
      typeof body?.attributes === "object" && body.attributes ? (body.attributes as Record<string, unknown>) : {},
    attributeDefinitions: Array.isArray(body?.attributeDefinitions)
      ? (body.attributeDefinitions as MercadoLivreAttributeDefinition[])
      : [],
    shippingMode: String(body?.shippingMode ?? "").trim(),
    logisticType: String(body?.logisticType ?? "").trim(),
    freeShipping: Boolean(body?.freeShipping),
    localPickup: Boolean(body?.localPickup),
    customShippingDescription: String(body?.customShippingDescription ?? "").trim(),
    customShippingCost: Number(body?.customShippingCost),
    customShippingDeadlineDays: Math.trunc(Number(body?.customShippingDeadlineDays)),
    widthCm: Number(body?.widthCm),
    heightCm: Number(body?.heightCm),
    lengthCm: Number(body?.lengthCm),
    weightGrams: Math.trunc(Number(body?.weightGrams)),
  };
}

export type MercadoLivreListingRequestError = { field: string; message: string; status: number };

/**
 * Regras verificadas antes de qualquer chamada ao Mercado Livre. Compartilhadas
 * por `POST /items` e pela etapa de validação para que as duas recusem o mesmo.
 */
export function collectMercadoLivreListingRequestErrors(
  request: MercadoLivreListingRequest,
  options: { requireProduto?: boolean } = {},
): MercadoLivreListingRequestError[] {
  const errors: MercadoLivreListingRequestError[] = [];
  const push = (field: string, message: string, status = 400) => errors.push({ field, message, status });

  if (options.requireProduto !== false && (!Number.isInteger(request.produtoId) || request.produtoId <= 0)) {
    push("general", "produtoId inválido.");
  }
  if (!request.title) push("title", "Informe o título do anúncio.");
  if (!request.categoryId) push("category", "Informe a categoria Mercado Livre.");
  if (!Number.isFinite(request.price) || request.price <= 0) push("price", "Informe um preço válido.");
  if (!Number.isInteger(request.availableQuantity) || request.availableQuantity <= 0) {
    push("stock", "Não é possível publicar anúncio sem estoque disponível.");
  }
  if (!isMercadoLivreListingTypeEnabled(request.listingTypeId)) {
    push("listingType", disabledMercadoLivreListingTypeMessage, 422);
  }
  if (!["new", "used", "not_specified"].includes(request.condition)) push("condition", "Condição inválida.");
  if (request.gtin && !isValidGtin(request.gtin)) {
    push("gtin", "O GTIN/EAN informado possui tamanho ou dígito verificador inválido.");
  }
  if (!parsePictureUrls(request.pictureUrl).length) {
    push("images", "Informe ao menos uma imagem pública válida para o anúncio.");
  }
  if (!["me2", "custom", "pickup"].includes(request.shippingMode)) {
    push("shipping", "O ERP publica anúncios apenas com Mercado Envios habilitado.");
  }
  if (request.shippingMode === "me2" && !request.logisticType) {
    push("shipping", "Selecione a logística do Mercado Envios.");
  }
  if (
    request.shippingMode === "me2" &&
    !buildMercadoLivreShippingDimensions({
      lengthCm: request.lengthCm,
      widthCm: request.widthCm,
      heightCm: request.heightCm,
      weightGrams: request.weightGrams,
    })
  ) {
    push(
      "dimensions",
      "Comprimento, largura e altura devem ser maiores que zero; o peso deve ser informado em gramas inteiras.",
    );
  }
  if (
    request.shippingMode === "custom" &&
    (!request.customShippingDescription ||
      !Number.isFinite(request.customShippingCost) ||
      request.customShippingCost < 0 ||
      !Number.isInteger(request.customShippingDeadlineDays) ||
      request.customShippingDeadlineDays <= 0)
  ) {
    push("shipping", "Informe descrição e valor para o envio personalizado.");
  }

  const requiredMissing = request.attributeDefinitions
    .filter((attribute) => attribute.required)
    .filter(
      (attribute) =>
        !hasAttributeValue(attribute, request.dynamicAttributes, {
          brand: request.brand,
          model: request.model,
          partNumber: request.partNumber,
          gtin: request.gtin,
        }),
    )
    .map((attribute) => attribute.name || attribute.id)
    .filter(Boolean);
  if (requiredMissing.length) {
    push("general", `Preencha os atributos obrigatórios: ${requiredMissing.join(", ")}.`);
  }

  return errors;
}

export function buildMercadoLivreItemPayload(input: BuildMercadoLivreItemPayloadInput): BuiltMercadoLivreItemPayload {
  const payload: Record<string, unknown> = {
    category_id: input.categoryId,
    price: input.price,
    currency_id: "BRL",
    available_quantity: input.availableQuantity,
    buying_mode: "buy_it_now",
    condition: input.condition,
    listing_type_id: input.listingTypeId,
    pictures: input.pictures,
  };

  if (input.userProductSeller) {
    payload.family_name = buildFamilyName({
      title: input.title,
      brand: input.brand,
      model: input.model,
      partNumber: input.partNumber,
      familyName: input.familyName,
    });
  } else {
    payload.title = input.title;
  }

  const attributesById = new Map<string, MercadoLivreAttributePayload>();
  const definitionsById = new Map(
    input.attributeDefinitions.map((attribute) => [String(attribute.id ?? "").toUpperCase(), attribute]),
  );
  for (const [id, value] of Object.entries(input.dynamicAttributes)) {
    const attrId = id.trim().toUpperCase();
    if (!attrId || attrId.endsWith("__UNIT")) continue;
    if (attrId === "GTIN" && !isValidGtin(input.gtin)) continue;
    if (attrId === "GTIN" && !isValidGtin(value)) continue;

    const attribute = buildAttributePayload(attrId, value, definitionsById.get(attrId), input.dynamicAttributes);
    if (attribute) attributesById.set(attrId, attribute);
  }
  if (input.brand) attributesById.set("BRAND", { id: "BRAND", value_name: input.brand });
  if (input.model) attributesById.set("MODEL", { id: "MODEL", value_name: input.model });
  if (input.partNumber) attributesById.set("PART_NUMBER", { id: "PART_NUMBER", value_name: input.partNumber });
  if (isValidGtin(input.gtin)) attributesById.set("GTIN", { id: "GTIN", value_name: input.gtin });
  for (const attribute of buildMercadoLivrePackageAttributes({
    shippingMode: input.shippingMode,
    lengthCm: input.lengthCm,
    widthCm: input.widthCm,
    heightCm: input.heightCm,
    weightGrams: input.weightGrams,
  })) {
    attributesById.set(attribute.id, attribute);
  }

  const attributes = Array.from(attributesById.values());
  if (attributes.length) payload.attributes = attributes;
  if (input.sku) payload.seller_custom_field = input.sku;

  const saleTerms = buildSaleTerms(input.warranty, input.warrantyTime);
  if (saleTerms.length) payload.sale_terms = saleTerms;

  const shipping = buildShippingPayload(input);
  if (shipping) payload.shipping = shipping;

  return { payload, attributes, saleTerms };
}

/**
 * Payload de envio documentado para ME2: `mode`, `local_pick_up`, `free_shipping`
 * e `free_methods`. `logistic_type` não é aceito aqui — ele serve para análise,
 * cálculo e conferência pós-publicação.
 */
export function buildShippingPayload(params: {
  shippingMode: string;
  freeShipping: boolean;
  customShippingDescription?: string;
  customShippingCost?: number;
  customShippingDeadlineDays?: number;
}) {
  if (!params.shippingMode) return null;

  if (params.shippingMode === "pickup") {
    return { mode: "custom", free_shipping: true, local_pick_up: true, methods: [] };
  }

  if (params.shippingMode === "custom") {
    const description = `${params.customShippingDescription ?? ""} - prazo ${params.customShippingDeadlineDays ?? 0} dia(s) úteis`;
    return {
      mode: "custom",
      free_shipping: params.freeShipping,
      local_pick_up: false,
      methods: [],
      costs: [{ description, cost: params.customShippingCost ?? 0 }],
    };
  }

  return {
    mode: params.shippingMode,
    local_pick_up: false,
    free_shipping: params.freeShipping,
    free_methods: [],
  };
}

export function buildSaleTerms(warranty: string, warrantyTime: string) {
  if (!warranty) return [];
  if (warranty === "Sem garantia") return [{ id: "WARRANTY_TYPE", value_name: warranty }];

  return [
    { id: "WARRANTY_TYPE", value_name: warranty },
    warrantyTime ? { id: "WARRANTY_TIME", value_name: warrantyTime } : null,
  ].filter(Boolean) as Array<Record<string, unknown>>;
}

/**
 * `family_name` das contas User Products. O título informado pelo usuário manda:
 * é o único campo de nome que o formulário expõe. `familyName` continua aceito
 * para chamadas que enviem um nome próprio, e marca/modelo/peça são a reserva
 * para um título vazio.
 */
export function buildFamilyName(params: {
  title: string;
  brand: string;
  model: string;
  partNumber: string;
  familyName?: string;
}) {
  const manual = String(params.familyName ?? "").trim();
  if (manual) return manual.replace(/\s+/g, " ").trim().slice(0, 60);

  const title = String(params.title ?? "").replace(/\s+/g, " ").trim();
  if (title) return title.slice(0, 60);

  return [params.brand, params.model, params.partNumber]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export function buildAttributePayload(
  attrId: string,
  value: unknown,
  definition: MercadoLivreAttributeDefinition | undefined,
  allValues: Record<string, unknown>,
): MercadoLivreAttributePayload | null {
  const valueName = String(value ?? "").trim();
  if (!valueName) return null;

  if (definition?.valueType === "number_unit") {
    const number = Number(valueName.replace(",", "."));
    const unit = String(
      allValues[`${attrId}__unit`] ??
        definition.defaultUnit ??
        definition.allowedUnits?.[0]?.id ??
        definition.allowedUnits?.[0]?.name ??
        "",
    ).trim();
    if (!Number.isFinite(number) || !unit) return null;
    return { id: attrId, value_struct: { number, unit } };
  }

  const selectedOption = definition?.values?.find((option) => option.name === valueName || option.id === valueName);
  if (selectedOption?.id) {
    return { id: attrId, value_id: selectedOption.id, value_name: selectedOption.name ?? valueName };
  }

  return {
    id: attrId,
    value_name: definition?.valueType === "boolean" ? normalizeBooleanValue(valueName) : valueName,
  };
}

export function hasAttributeValue(
  attribute: MercadoLivreAttributeDefinition,
  values: Record<string, unknown>,
  fixedValues: { brand: string; model: string; partNumber: string; gtin: string },
) {
  const id = String(attribute.id ?? "").toUpperCase();
  if (id === "BRAND" && fixedValues.brand) return true;
  if (id === "MODEL" && fixedValues.model) return true;
  if (id === "PART_NUMBER" && fixedValues.partNumber) return true;
  if (id === "GTIN" && fixedValues.gtin) return true;

  const value = String(values[id] ?? "").trim();
  if (!value) return false;
  if (attribute.valueType !== "number_unit") return true;

  const unit = String(
    values[`${id}__unit`] ?? attribute.defaultUnit ?? attribute.allowedUnits?.[0]?.id ?? attribute.allowedUnits?.[0]?.name ?? "",
  ).trim();
  return Boolean(unit);
}

export function normalizeBooleanValue(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "sim", "yes", "1"].includes(normalized)) return "Sim";
  if (["false", "não", "nao", "no", "0"].includes(normalized)) return "Não";
  return String(value ?? "").trim();
}

export function isValidGtin(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return false;
  const body = digits.slice(0, -1);
  const sum = [...body]
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

export function parsePictureUrls(value: string) {
  return value
    .split(/\r?\n/)
    .map((source) => source.trim())
    .filter((source) => {
      try {
        const url = new URL(source);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    });
}

/* -------------------------------------------------------------------------- */
/* /items/validate                                                             */
/* -------------------------------------------------------------------------- */

/** O que o ERP pediu, para traduzir a recusa do Mercado Livre sem chutar. */
export type MercadoLivreErrorContext = { shippingMode?: string };

export type MercadoLivreValidationResult = {
  valid: boolean;
  status: number;
  /** Causas informativas que não impedem a publicação. */
  warnings: string[];
  errors: string[];
  fieldErrors: Record<string, string>;
  validation: unknown;
};

/**
 * `POST /items/validate` responde `204 No Content` quando a publicação está
 * correta — nesse caso não existe corpo JSON para ler.
 */
export async function runMercadoLivreItemValidation(
  accessToken: string,
  payload: Record<string, unknown>,
  context: MercadoLivreErrorContext = {},
): Promise<MercadoLivreValidationResult> {
  const response = await fetch("https://api.mercadolibre.com/items/validate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (response.status === 204 || response.ok) {
    return { valid: true, status: response.status, warnings: [], errors: [], fieldErrors: {}, validation: null };
  }

  const text = await response.text();
  let validation: any = { message: text };
  try {
    validation = text ? JSON.parse(text) : {};
  } catch {
    // Mantém a resposta bruta para validações não documentadas.
  }

  const shipping = payload.shipping as Record<string, unknown> | undefined;
  const onlyWarnings = hasOnlyMercadoLivreValidationWarnings(validation);
  const legacyMe1 = String(shipping?.mode ?? "").toLowerCase() === "me2" && isLegacyMe1ValidationError(validation);
  const messages = collectValidationMessages(validation, context);

  if (legacyMe1) {
    // A validação passou: o Mercado Livre só reportou a ausência do modo legado
    // ME1, que não se aplica a um anúncio ME2. Dizer isso, e não repetir a
    // recusa crua, evita parecer que a publicação foi negada.
    return {
      valid: true,
      status: response.status,
      warnings: [
        "O Mercado Livre mencionou o modo legado ME1, que esta conta não possui. Isso não impede a publicação com Mercado Envios (ME2) e o anúncio segue válido.",
      ],
      errors: [],
      fieldErrors: {},
      validation,
    };
  }
  if (onlyWarnings) {
    return { valid: true, status: response.status, warnings: messages, errors: [], fieldErrors: {}, validation };
  }

  return {
    valid: false,
    status: response.status,
    warnings: [],
    errors: messages,
    fieldErrors: buildValidationFieldErrors(validation),
    validation,
  };
}

/** Mantém o comportamento de `POST /items`: lança quando a validação recusa o anúncio. */
export async function assertMercadoLivreItemIsValid(
  accessToken: string,
  payload: Record<string, unknown>,
  context: MercadoLivreErrorContext = {},
) {
  const result = await runMercadoLivreItemValidation(accessToken, payload, context);
  if (result.valid) return result;

  const error = new Error(`Validação do anúncio recusada: ${JSON.stringify(result.validation)}`);
  (error as any).status = 422;
  (error as any).validation = result.validation;
  (error as any).fieldErrors = result.fieldErrors;
  throw error;
}

function collectValidationMessages(validation: unknown, context: MercadoLivreErrorContext = {}): string[] {
  const causes = validationCauses(validation);
  const messages = causes
    .map((cause) => {
      if (!cause || typeof cause !== "object") return String(cause ?? "");
      const detail = cause as Record<string, unknown>;
      const references = Array.isArray(detail.references) && detail.references.length
        ? ` (${detail.references.join(", ")})`
        : "";
      const message = String(detail.message ?? detail.msg ?? detail.cause ?? detail.code ?? "");
      return message ? translateMercadoLivreError(`${message}${references}`, context) : "";
    })
    .filter(Boolean);

  if (messages.length) return Array.from(new Set(messages));
  const root = validation && typeof validation === "object" ? (validation as Record<string, unknown>) : {};
  const fallback = String(root.message ?? root.error ?? "");
  return fallback ? [translateMercadoLivreError(fallback, context)] : [];
}

function validationCauses(validation: unknown): unknown[] {
  if (!validation || typeof validation !== "object") return [];
  const value = validation as Record<string, unknown>;
  return [
    ...(Array.isArray(value.cause) ? value.cause : []),
    ...(Array.isArray(value.cause_list) ? value.cause_list : []),
  ];
}

export function isLegacyMe1ValidationError(validation: unknown) {
  if (!validation || typeof validation !== "object") return /user has not mode me1/i.test(String(validation ?? ""));

  const causeMessages = validationCauses(validation)
    .map((cause) => {
      if (!cause || typeof cause !== "object") return String(cause ?? "");
      const detail = cause as Record<string, unknown>;
      return String(detail.message ?? detail.msg ?? "");
    })
    .filter(Boolean);

  if (causeMessages.length) return causeMessages.every((message) => /user has not mode me1/i.test(message));
  return /user has not mode me1/i.test(String((validation as Record<string, unknown>).message ?? ""));
}

export function buildValidationFieldErrors(validation: any) {
  const causes = Array.isArray(validation?.cause)
    ? validation.cause
    : Array.isArray(validation?.cause_list)
      ? validation.cause_list
      : [validation];
  const result: Record<string, string> = {};
  for (const cause of causes) {
    const rawMessage = String(
      cause?.message || cause?.msg || cause?.error || validation?.message || "Campo recusado pelo Mercado Livre.",
    );
    const message = translateMercadoLivreError(rawMessage);
    const reference = [cause?.code, ...(Array.isArray(cause?.references) ? cause.references : [])].join(" ").toLowerCase();
    const attributeId = rawMessage.match(/Attribute\s*\[([^\]]+)\]/i)?.[1]?.toUpperCase();
    const key = attributeId
      ? `attr:${attributeId}`
      : reference.includes("family") ? "family"
        : reference.includes("title") ? "title"
          : reference.includes("category") ? "category"
            : reference.includes("price") ? "price"
              : reference.includes("available_quantity") ? "stock"
                : reference.includes("picture") ? "images"
                  : reference.includes("listing_type") ? "listingType"
                    : reference.includes("condition") ? "condition"
                      : reference.includes("seller_package") || reference.includes("dimension") ? "dimensions"
                        : reference.includes("shipping") || /user has not mode me[12]/i.test(rawMessage) ? "shipping"
                          : "general";
    result[key] = message;
  }
  return result;
}

export function formatMercadoLivreError(error: any, context: MercadoLivreErrorContext = {}) {
  const raw = String(error?.message ?? "");
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) return translateMercadoLivreError(raw, context);

  try {
    const parsed = JSON.parse(raw.slice(jsonStart));
    const causes = Array.isArray(parsed.cause) ? parsed.cause : Array.isArray(parsed.cause_list) ? parsed.cause_list : [];
    const details = causes
      .map((cause: any) => {
        const references = Array.isArray(cause?.references) ? ` (${cause.references.join(", ")})` : "";
        return cause?.message || cause?.msg || cause?.cause || (cause?.code ? `${cause.code}${references}` : null);
      })
      .filter(Boolean)
      .join("; ");
    return translateMercadoLivreError(details || parsed.error || parsed.message || raw, context);
  } catch {
    return translateMercadoLivreError(raw, context);
  }
}

export function translateMercadoLivreError(message: string, context: MercadoLivreErrorContext = {}) {
  const normalized = message.toLowerCase();
  if (normalized.includes("seller.unable_to_list") || normalized.includes("seller is not allowed to publish")) {
    return "Conta vendedora: o Mercado Livre bloqueou novas publicações. Verifique identidade, dados cadastrais, reputação e avisos pendentes na conta.";
  }
  if (normalized.includes("listing_type") || normalized.includes("listing type")) {
    return "Tipo de anúncio: a opção selecionada não está disponível para esta conta, categoria ou preço. Selecione uma das opções habilitadas no formulário.";
  }
  if (normalized.includes("transactions.exceeded")) {
    return "Tipo de anúncio Grátis: o limite de vendas permitido para anúncios gratuitos foi ultrapassado.";
  }
  if (/user has not mode me1/i.test(message)) {
    // O Mercado Livre reporta a falta do modo legado ME1 ao recusar tanto o
    // envio próprio quanto o personalizado. Dizer "selecione ME2" só ajuda se
    // o pedido não era ME2; quando já era, o problema está na logística.
    const requested = String(context.shippingMode ?? "").toLowerCase();
    if (requested === "pickup" || requested === "custom") {
      return "Campos de Envio: a conta Mercado Livre não tem envio próprio (ME1) habilitado, por isso as modalidades Retirada / própria e Envio personalizado foram recusadas. Publique este anúncio com Mercado Envios (ME2).";
    }
    return "Campos de Envio: o Mercado Livre tentou aplicar o modo legado ME1 para este anúncio. Revise a logística do Mercado Envios retornada para a categoria, as dimensões e o peso informados.";
  }
  if (normalized.includes("conflict")) {
    return "Campo Título do anúncio: o Mercado Livre encontrou conflito com um cadastro existente. Deixe o título mais específico, incluindo marca, modelo e a referência exata da peça.";
  }
  if (message.includes("[family_name]")) {
    return "Campo Título do anúncio: o Mercado Livre recusou o nome enviado. Ajuste o título e publique novamente.";
  }
  if (message.includes("fields [title]") || message.includes("[title]")) {
    return "Campo Título do anúncio: o Mercado Livre recusou o título informado. Ajuste o texto e publique novamente.";
  }
  if (message.includes("[GTIN]") || message.includes("GTIN")) {
    return "Campo GTIN / EAN: o Mercado Livre recusou o código informado. Para teste ou produto sem código confirmado, deixe o GTIN vazio.";
  }
  if (message.includes("shipping") || message.includes("dimensions") || message.includes("SELLER_PACKAGE")) {
    return "Campos de Envio: o Mercado Livre recusou dimensões, peso ou configuração de Mercado Envios. Revise comprimento, largura, altura, peso e cadastro de envio do vendedor.";
  }
  if (message.includes("category_id") || message.includes("category")) {
    return "Campo Categoria Mercado Livre: a categoria foi recusada. Selecione novamente a categoria final do produto.";
  }
  if (message.includes("price")) {
    return "Campo Preço: o Mercado Livre recusou o preço informado.";
  }
  if (message.includes("body.invalid_fields")) {
    return "O Mercado Livre recusou um ou mais campos do anúncio. Revise família do produto, envio, dimensões, garantia e atributos obrigatórios da categoria.";
  }

  return message
    .replaceAll("Validation error", "Erro de validação")
    .replaceAll("Attribute", "Atributo")
    .replaceAll("ignored because it is not modifiable", "ignorado porque não pode ser alterado")
    .replaceAll("Product Identifier", "Identificador do produto")
    .replaceAll("contains values with invalid format", "possui valor em formato inválido")
    .replaceAll("The caller is not authorized to access this resource", "A conta conectada não tem autorização para acessar este recurso")
    .replaceAll("Item pictures are mandatory", "Informe ao menos uma imagem do anúncio")
    .replaceAll("invalid price", "Preço inválido")
    .replaceAll("invalid category", "Categoria inválida");
}
