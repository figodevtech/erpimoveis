import { NextResponse } from "next/server";
import { requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { mercadoLivreApiGet, mercadoLivreApiPost, mercadoLivreApiPut } from "@/lib/integrations/mercadolivre";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import {
  buildMercadoLivrePackageAttributes,
  hasOnlyMercadoLivreValidationWarnings,
} from "@/lib/integrations/mercadolivre-listing-validation";
import { uploadMercadoLivrePictures } from "@/lib/integrations/mercadolivre-pictures";
import {
  validateMercadoLivreShippingForListing,
  validateMercadoLivreShippingSelection,
} from "@/lib/integrations/mercadolivre-shipping-preferences";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MercadoLivreCreatedItem = {
  id?: string;
  title?: string;
  permalink?: string;
  status?: string;
  [key: string]: unknown;
};

type MercadoLivreSeller = {
  tags?: string[];
  status?: { list?: { allow?: boolean; codes?: string[] } };
};

type AttributeDefinition = {
  id?: string;
  name?: string;
  valueType?: string;
  required?: boolean;
  values?: Array<{ id?: string; name?: string }>;
  allowedUnits?: Array<{ id?: string; name?: string }>;
  defaultUnit?: string | null;
};

type MlAttributePayload = {
  id: string;
  value_id?: string;
  value_name?: string;
  value_struct?: {
    number: number;
    unit: string;
  };
};

export async function POST(req: Request) {
  try {
    await requireVendasEdit();
    const empresaId = await requireEmpresaId();
    const body = await req.json().catch(() => ({}));

    const produtoId = Number(body?.produtoId);
    const title = String(body?.title ?? "").trim();
    const categoryId = String(body?.categoryId ?? "").trim().toUpperCase();
    const description = String(body?.description ?? "").trim();
    const price = Number(body?.price);
    const availableQuantity = Math.trunc(Number(body?.availableQuantity));
    const condition = String(body?.condition ?? "new").trim().toLowerCase();
    const listingTypeId = String(body?.listingTypeId ?? "gold_special").trim();
    const pictureUrl = String(body?.pictureUrl ?? "").trim();
    const brand = String(body?.brand ?? "").trim();
    const model = String(body?.model ?? "").trim();
    const partNumber = String(body?.partNumber ?? "").trim();
    const familyName = String(body?.familyName ?? "").trim();
    const gtin = String(body?.gtin ?? "").trim();
    const sku = String(body?.sku ?? "").trim();
    const warranty = String(body?.warranty ?? "").trim();
    const warrantyTime = String(body?.warrantyTime ?? "").trim();
    const dynamicAttributes = typeof body?.attributes === "object" && body.attributes ? (body.attributes as Record<string, unknown>) : {};
    const attributeDefinitions = Array.isArray(body?.attributeDefinitions) ? (body.attributeDefinitions as AttributeDefinition[]) : [];
    const shippingMode = String(body?.shippingMode ?? "").trim();
    const logisticType = String(body?.logisticType ?? "").trim();
    const freeShipping = Boolean(body?.freeShipping);
    const localPickup = Boolean(body?.localPickup);
    const customShippingDescription = String(body?.customShippingDescription ?? "").trim();
    const customShippingCost = Number(body?.customShippingCost);
    const customShippingDeadlineDays = Math.trunc(Number(body?.customShippingDeadlineDays));
    const widthCm = Number(body?.widthCm);
    const heightCm = Number(body?.heightCm);
    const lengthCm = Number(body?.lengthCm);
    const weightGrams = Math.trunc(Number(body?.weightGrams));

    if (!Number.isInteger(produtoId) || produtoId <= 0) {
      return NextResponse.json({ error: "produtoId inválido." }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: "Informe o título do anúncio." }, { status: 400 });
    }
    if (!categoryId) {
      return NextResponse.json({ error: "Informe a categoria Mercado Livre." }, { status: 400 });
    }
    if (!Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: "Informe um preço válido." }, { status: 400 });
    }
    if (!Number.isInteger(availableQuantity) || availableQuantity <= 0) {
      return NextResponse.json({ error: "Não é possível publicar anúncio sem estoque disponível." }, { status: 400 });
    }
    if (listingTypeId === "free" && availableQuantity > 1) {
      return NextResponse.json(
        {
          error: "Anúncios grátis permitem estoque máximo de 1 unidade.",
          fieldErrors: { stock: "Reduza o estoque do anúncio grátis para 1 unidade ou escolha Clássico/Premium." },
        },
        { status: 400 },
      );
    }
    if (!["new", "used", "not_specified"].includes(condition)) {
      return NextResponse.json({ error: "Condição inválida." }, { status: 400 });
    }
    if (gtin && !isValidGtin(gtin)) {
      return NextResponse.json(
        {
          error: "O GTIN/EAN informado possui tamanho ou dígito verificador inválido.",
          fieldErrors: { gtin: "Informe um GTIN/EAN válido ou deixe o campo vazio.", "attr:GTIN": "Código GTIN/EAN inválido." },
        },
        { status: 400 },
      );
    }

    const pictureSources = parsePictureUrls(pictureUrl);
    if (!pictureSources.length) {
      return NextResponse.json({ error: "Informe ao menos uma imagem pública válida para o anúncio." }, { status: 400 });
    }

    if (!["me2", "custom", "pickup"].includes(shippingMode)) {
      return NextResponse.json({ error: "O ERP publica anúncios apenas com Mercado Envios habilitado." }, { status: 400 });
    }
    if (shippingMode === "me2" && !logisticType) {
      return NextResponse.json({ error: "Selecione a logística do Mercado Envios." }, { status: 400 });
    }
    if (shippingMode === "me2" && (![widthCm, heightCm, lengthCm].every((value) => Number.isFinite(value) && value > 0) || !Number.isInteger(weightGrams) || weightGrams <= 0)) {
      return NextResponse.json(
        {
          error: "Informe dimensões e peso válidos para calcular o Mercado Envios.",
          fieldErrors: {
            dimensions: "Comprimento, largura e altura devem ser maiores que zero; o peso deve ser informado em gramas inteiras.",
          },
        },
        { status: 400 },
      );
    }

    if (shippingMode === "custom" && (!customShippingDescription || !Number.isFinite(customShippingCost) || customShippingCost < 0 || !Number.isInteger(customShippingDeadlineDays) || customShippingDeadlineDays <= 0)) {
      return NextResponse.json({ error: "Informe descrição e valor para o envio personalizado." }, { status: 400 });
    }

    const requiredMissing = attributeDefinitions
      .filter((attribute) => attribute.required)
      .filter((attribute) => !hasAttributeValue(attribute, dynamicAttributes, { brand, model, partNumber, gtin }))
      .map((attribute) => attribute.name || attribute.id)
      .filter(Boolean);

    if (requiredMissing.length) {
      return NextResponse.json(
        { error: `Preencha os atributos obrigatórios: ${requiredMissing.join(", ")}.` },
        { status: 400 },
      );
    }

    const account = await getValidMercadoLivreAccount(empresaId);
    const seller = await mercadoLivreApiGet<MercadoLivreSeller>(account.access_token, `/users/${account.ml_user_id}`);
    const sellerTags = Array.isArray(seller?.tags) ? seller.tags.map(String) : [];
    const userProductSeller = sellerTags.includes("user_product_seller");
    if (seller.status?.list?.allow === false) {
      throw listingValidationError(
        `A conta Mercado Livre não está autorizada a publicar. ${translateSellerRestrictionCodes(seller.status.list.codes).join(" ")}`.trim(),
        "general",
      );
    }
    await validateListingTypeAvailability(account.access_token, account.ml_user_id, categoryId, listingTypeId);
    await validateMercadoLivreShippingSelection(account, categoryId, shippingMode, logisticType);

    const { data: existingLink, error: linkError } = await supabaseAdmin
      .from("mercadolivre_product_link")
      .select("id, ml_item_id")
      .eq("empresa_id", account.empresa_id)
      .eq("produto_id", produtoId)
      .maybeSingle();

    if (linkError) throw linkError;
    if (existingLink?.ml_item_id) {
      return NextResponse.json({ error: "Este produto já possui anúncio Mercado Livre vinculado." }, { status: 409 });
    }
    const pictures = await uploadMercadoLivrePictures(account.access_token, pictureSources);

    const itemPayload: Record<string, unknown> = {
      category_id: categoryId,
      price,
      currency_id: "BRL",
      available_quantity: availableQuantity,
      buying_mode: "buy_it_now",
      condition,
      listing_type_id: listingTypeId,
      pictures,
    };
    if (userProductSeller) itemPayload.family_name = buildFamilyName({ title, brand, model, partNumber, familyName });
    else itemPayload.title = title;

    const attributesById = new Map<string, MlAttributePayload>();
    const definitionsById = new Map(attributeDefinitions.map((attribute) => [String(attribute.id ?? "").toUpperCase(), attribute]));
    for (const [id, value] of Object.entries(dynamicAttributes)) {
      const attrId = id.trim().toUpperCase();
      if (!attrId || attrId.endsWith("__UNIT")) continue;
      if (attrId === "GTIN" && !isValidGtin(gtin)) continue;
      if (attrId === "GTIN" && !isValidGtin(value)) continue;

      const attribute = buildAttributePayload(attrId, value, definitionsById.get(attrId), dynamicAttributes);
      if (attribute) attributesById.set(attrId, attribute);
    }
    if (brand) attributesById.set("BRAND", { id: "BRAND", value_name: brand });
    if (model) attributesById.set("MODEL", { id: "MODEL", value_name: model });
    if (partNumber) attributesById.set("PART_NUMBER", { id: "PART_NUMBER", value_name: partNumber });
    if (isValidGtin(gtin)) attributesById.set("GTIN", { id: "GTIN", value_name: gtin });
    for (const attribute of buildMercadoLivrePackageAttributes({ shippingMode, lengthCm, widthCm, heightCm, weightGrams })) {
      attributesById.set(attribute.id, attribute);
    }

    const attributes = Array.from(attributesById.values());
    if (attributes.length) itemPayload.attributes = attributes;

    if (sku) itemPayload.seller_custom_field = sku;

    const saleTerms = buildSaleTerms(warranty, warrantyTime);
    if (saleTerms.length) itemPayload.sale_terms = saleTerms;

    const shipping = buildShippingPayload({
      shippingMode,
      logisticType,
      freeShipping,
      localPickup,
      customShippingDescription,
      customShippingCost,
      customShippingDeadlineDays,
      widthCm,
      heightCm,
      lengthCm,
      weightGrams,
    });
    if (shipping) itemPayload.shipping = shipping;

    if (shippingMode === "me2") {
      await validateMercadoLivreShippingForListing(account, shippingMode, logisticType, {
        title,
        categoryId,
        price,
        currencyId: "BRL",
        listingTypeId,
        condition,
        localPickup,
        dimensions: buildShippingDimensions({ lengthCm, widthCm, heightCm, weightGrams }),
        saleTerms,
        attributes,
      });
    }

    await validateMercadoLivreItem(account.access_token, itemPayload);
    const item = await mercadoLivreApiPost<MercadoLivreCreatedItem>(account.access_token, "/items", itemPayload);
    if (!item?.id) {
      return NextResponse.json({ error: "Mercado Livre não retornou o código do anúncio criado." }, { status: 502 });
    }

    const verifiedItem = await verifyCreatedItemOrClose(account.access_token, item.id, shippingMode === "me2");
    const userProduct = verifiedItem?.user_product_id
      ? await mercadoLivreApiGet<any>(account.access_token, `/user-products/${encodeURIComponent(String(verifiedItem.user_product_id))}`).catch(() => null)
      : null;
    const enrichedItem = userProduct ? { ...verifiedItem, _erp_user_product: userProduct } : verifiedItem;

    if (description) {
      try {
        await mercadoLivreApiPost(account.access_token, `/items/${encodeURIComponent(item.id)}/description`, {
          plain_text: description,
        });
      } catch (descriptionError) {
        await mercadoLivreApiPut(account.access_token, `/items/${encodeURIComponent(item.id)}`, { status: "closed" }).catch(() => null);
        throw descriptionError;
      }
    }

    const { data, error } = await supabaseAdmin
      .from("mercadolivre_product_link")
      .upsert(
        {
          empresa_id: account.empresa_id,
          produto_id: produtoId,
          ml_item_id: item.id,
          title: enrichedItem.title ?? item.title ?? title,
          permalink: enrichedItem.permalink ?? item.permalink ?? null,
          status: enrichedItem.status ?? item.status ?? null,
          user_product_id: enrichedItem.user_product_id ?? null,
          family_id: userProduct?.family_id ?? enrichedItem.family_id ?? null,
          family_name: enrichedItem.family_name ?? userProduct?.family_name ?? null,
          domain_id: enrichedItem.domain_id ?? userProduct?.domain_id ?? null,
          catalog_product_id: enrichedItem.catalog_product_id ?? userProduct?.catalog_product_id ?? null,
          user_product_enabled: Boolean(enrichedItem.family_name || enrichedItem.user_product_id),
          item_tags: Array.isArray(enrichedItem.tags) ? enrichedItem.tags : [],
          package_length_cm: lengthCm,
          package_width_cm: widthCm,
          package_height_cm: heightCm,
          package_weight_grams: weightGrams,
          raw_item: enrichedItem ?? item ?? {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: "empresa_id,produto_id" },
      )
      .select("id, empresa_id, produto_id, ml_item_id, ml_variation_id, title, permalink, status, updated_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ data, item: enrichedItem, model: userProductSeller ? "user_product" : "legacy" });
  } catch (e: any) {
    console.error("POST /api/integracoes/mercadolivre/items", e);
    return NextResponse.json(
      {
        error: formatMercadoLivreError(e) || "Falha ao criar anúncio Mercado Livre.",
        fieldErrors: e?.fieldErrors ?? undefined,
        validation: e?.validation ?? undefined,
      },
      { status: Number(e?.status) || errorStatus(e) },
    );
  }
}

async function validateMercadoLivreItem(accessToken: string, payload: Record<string, unknown>) {
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
  if (response.ok) return;

  const text = await response.text();
  let validation: any = { message: text };
  try {
    validation = text ? JSON.parse(text) : {};
  } catch {
    // Keep the raw response so the user can identify an undocumented validation.
  }

  const shipping = payload.shipping as Record<string, unknown> | undefined;
  // /items/validate can answer 400 even when every cause is advisory. The real
  // item creation remains authoritative and will still reject actual errors.
  if (hasOnlyMercadoLivreValidationWarnings(validation)) return;
  if (String(shipping?.mode ?? "").toLowerCase() === "me2" && isLegacyMe1ValidationError(validation)) {
    return;
  }

  const error = new Error(`Validação do anúncio recusada: ${JSON.stringify(validation)}`);
  (error as any).status = 422;
  (error as any).validation = validation;
  (error as any).fieldErrors = buildValidationFieldErrors(validation);
  throw error;
}

function isLegacyMe1ValidationError(validation: unknown) {
  if (!validation || typeof validation !== "object") return /user has not mode me1/i.test(String(validation ?? ""));

  const value = validation as Record<string, unknown>;
  const causes = [
    ...(Array.isArray(value.cause) ? value.cause : []),
    ...(Array.isArray(value.cause_list) ? value.cause_list : []),
  ];
  const causeMessages = causes
    .map((cause) => {
      if (!cause || typeof cause !== "object") return String(cause ?? "");
      const detail = cause as Record<string, unknown>;
      return String(detail.message ?? detail.msg ?? "");
    })
    .filter(Boolean);

  if (causeMessages.length) return causeMessages.every((message) => /user has not mode me1/i.test(message));
  return /user has not mode me1/i.test(String(value.message ?? ""));
}

function buildValidationFieldErrors(validation: any) {
  const causes = Array.isArray(validation?.cause)
    ? validation.cause
    : Array.isArray(validation?.cause_list)
      ? validation.cause_list
      : [validation];
  const result: Record<string, string> = {};
  for (const cause of causes) {
    const rawMessage = String(cause?.message || cause?.msg || cause?.error || validation?.message || "Campo recusado pelo Mercado Livre.");
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

function parsePictureUrls(value: string) {
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

async function validateListingTypeAvailability(
  accessToken: string,
  sellerId: number,
  categoryId: string,
  listingTypeId: string,
) {
  const availability = await mercadoLivreApiGet<{ available?: Array<{ id?: string; remaining_listings?: number | null }> }>(
    accessToken,
    `/users/${sellerId}/available_listing_types?category_id=${encodeURIComponent(categoryId)}`,
  ).catch(() => null);
  if (!availability || !Array.isArray(availability.available)) return;

  const selected = availability.available.find((item) => String(item.id ?? "") === listingTypeId);
  if (selected) {
    if (listingTypeId === "free" && selected.remaining_listings != null && selected.remaining_listings <= 0) {
      throw listingValidationError("A cota de anúncios grátis desta conta foi atingida.", "listingType");
    }
    return;
  }

  const detail = await mercadoLivreApiGet<{ cause?: string; code?: string }>(
    accessToken,
    `/users/${sellerId}/available_listing_type/${encodeURIComponent(listingTypeId)}?category_id=${encodeURIComponent(categoryId)}`,
  ).catch(() => null);
  throw listingValidationError(translateListingAvailabilityError(detail?.cause, detail?.code), "listingType");
}

function listingValidationError(message: string, field: string) {
  const error = new Error(message);
  (error as any).status = 422;
  (error as any).fieldErrors = { [field]: message };
  return error;
}

function translateListingAvailabilityError(cause?: string, code?: string) {
  const normalizedCode = String(code ?? "").toLowerCase();
  if (normalizedCode.includes("transactions.exceeded")) return "O limite de vendas permitido para anúncios grátis foi ultrapassado.";
  if (normalizedCode.includes("feedback.not_allowed")) return "A reputação atual da conta não permite este tipo de anúncio.";
  if (normalizedCode.includes("listings.exceeded")) return "A cota de anúncios deste tipo foi atingida.";
  return cause || "O tipo de anúncio selecionado não está disponível para esta conta e categoria.";
}

function translateSellerRestrictionCodes(codes?: string[]) {
  const labels: Record<string, string> = {
    identification_pending: "A validação de identidade está pendente.",
    identification_required: "É necessário validar a identidade da conta.",
    contact_data_pending: "Complete os dados de contato da conta.",
  };
  return (codes ?? []).map((code) => labels[String(code).toLowerCase()] || `Restrição: ${code}.`);
}

function normalizeBooleanValue(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "sim", "yes", "1"].includes(normalized)) return "Sim";
  if (["false", "não", "nao", "no", "0"].includes(normalized)) return "Não";
  return String(value ?? "").trim();
}

function isValidGtin(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return false;
  const body = digits.slice(0, -1);
  const sum = [...body]
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

function buildAttributePayload(
  attrId: string,
  value: unknown,
  definition: AttributeDefinition | undefined,
  allValues: Record<string, unknown>,
): MlAttributePayload | null {
  const valueName = String(value ?? "").trim();
  if (!valueName) return null;

  if (definition?.valueType === "number_unit") {
    const number = Number(valueName.replace(",", "."));
    const unit = String(allValues[`${attrId}__unit`] ?? definition.defaultUnit ?? definition.allowedUnits?.[0]?.id ?? definition.allowedUnits?.[0]?.name ?? "").trim();
    if (!Number.isFinite(number) || !unit) return null;
    return { id: attrId, value_struct: { number, unit } };
  }

  const selectedOption = definition?.values?.find((option) => option.name === valueName || option.id === valueName);
  if (selectedOption?.id) {
    return {
      id: attrId,
      value_id: selectedOption.id,
      value_name: selectedOption.name ?? valueName,
    };
  }

  return {
    id: attrId,
    value_name: definition?.valueType === "boolean" ? normalizeBooleanValue(valueName) : valueName,
  };
}

function hasAttributeValue(
  attribute: AttributeDefinition,
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

  const unit = String(values[`${id}__unit`] ?? attribute.defaultUnit ?? attribute.allowedUnits?.[0]?.id ?? attribute.allowedUnits?.[0]?.name ?? "").trim();
  return Boolean(unit);
}

function buildSaleTerms(warranty: string, warrantyTime: string) {
  if (!warranty) return [];
  if (warranty === "Sem garantia") return [{ id: "WARRANTY_TYPE", value_name: warranty }];

  return [
    { id: "WARRANTY_TYPE", value_name: warranty },
    warrantyTime ? { id: "WARRANTY_TIME", value_name: warrantyTime } : null,
  ].filter(Boolean);
}

function buildShippingPayload(params: {
  shippingMode: string;
  logisticType: string;
  freeShipping: boolean;
  localPickup: boolean;
  customShippingDescription: string;
  customShippingCost: number;
  customShippingDeadlineDays: number;
  widthCm: number;
  heightCm: number;
  lengthCm: number;
  weightGrams: number;
}) {
  if (!params.shippingMode) return null;
  if (params.shippingMode === "pickup") {
    return {
      mode: "custom",
      free_shipping: true,
      local_pick_up: true,
      methods: [],
    };
  }

  if (params.shippingMode === "custom") {
    const description = `${params.customShippingDescription} - prazo ${params.customShippingDeadlineDays} dia(s) úteis`;
    return {
      mode: "custom",
      free_shipping: params.freeShipping,
      local_pick_up: false,
      methods: [],
      costs: [{ description, cost: params.customShippingCost }],
    };
  }

  return {
    mode: params.shippingMode,
    free_shipping: params.freeShipping,
    local_pick_up: false,
  };
}

function buildShippingDimensions(params: { lengthCm: number; widthCm: number; heightCm: number; weightGrams: number }) {
  if (
    ![params.lengthCm, params.widthCm, params.heightCm].every((value) => Number.isFinite(value) && value > 0) ||
    !Number.isInteger(params.weightGrams) ||
    params.weightGrams <= 0
  ) {
    return null;
  }
  return `${params.lengthCm}x${params.widthCm}x${params.heightCm},${params.weightGrams}`;
}

async function verifyCreatedItemOrClose(accessToken: string, itemId: string, requireMercadoEnvios: boolean) {
  let item: any = null;
  const maxAttempts = requireMercadoEnvios ? 5 : 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    item = await mercadoLivreApiGet<any>(accessToken, `/items/${encodeURIComponent(itemId)}`);
    const hasPictures = Array.isArray(item?.pictures) && item.pictures.length > 0;
    if (hasPictures && (!requireMercadoEnvios || hasConfirmedMercadoEnvios(item))) break;
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 750 + attempt * 250));
    }
  }

  if (!Array.isArray(item?.pictures) || item.pictures.length === 0) {
    await mercadoLivreApiPut(accessToken, `/items/${encodeURIComponent(itemId)}`, { status: "closed" }).catch(() => null);
    throw listingValidationError(
      "O Mercado Livre não associou nenhuma imagem ao anúncio. Ele foi encerrado automaticamente; revise as imagens e publique novamente.",
      "images",
    );
  }

  if (!requireMercadoEnvios) return item;
  const shipping = item?.shipping ?? {};
  const mode = String(shipping?.mode ?? "").toLowerCase();
  const logisticType = String(shipping?.logistic_type ?? "").toLowerCase();
  const localPickup = Boolean(shipping?.local_pick_up);

  if (mode === "me2" && logisticType && !localPickup) return item;

  await mercadoLivreApiPut(accessToken, `/items/${encodeURIComponent(itemId)}`, { status: "closed" }).catch(() => null);

  throw listingValidationError(
    [
      "O Mercado Livre criou o anúncio sem Mercado Envios e ele foi encerrado automaticamente pelo ERP.",
      `Modo retornado: ${mode || "não informado"}.`,
      logisticType ? `Logística retornada: ${logisticType}.` : "Nenhuma logística operacional foi retornada.",
      localPickup ? "Retirada local veio habilitada." : "",
      "Revise o cadastro do vendedor no Mercado Livre, endereço de origem, categoria e se a conta de teste está habilitada para Mercado Envios.",
    ]
      .filter(Boolean)
      .join(" "),
    "shipping",
  );
}

function hasConfirmedMercadoEnvios(item: any) {
  const shipping = item?.shipping ?? {};
  return (
    String(shipping?.mode ?? "").toLowerCase() === "me2" &&
    Boolean(String(shipping?.logistic_type ?? "").trim()) &&
    !Boolean(shipping?.local_pick_up)
  );
}

function buildFamilyName(params: { title: string; brand: string; model: string; partNumber: string; familyName?: string }) {
  const manual = String(params.familyName ?? "").trim();
  if (manual) return manual.replace(/\s+/g, " ").trim().slice(0, 60);

  const value = [params.brand, params.model, params.partNumber]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");

  return (value || params.title).replace(/\s+/g, " ").trim().slice(0, 60);
}

function formatMercadoLivreError(error: any) {
  const raw = String(error?.message ?? "");
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) return translateMercadoLivreError(raw);

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
    return translateMercadoLivreError(details || parsed.error || parsed.message || raw);
  } catch {
    return translateMercadoLivreError(raw);
  }
}

function translateMercadoLivreError(message: string) {
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
    return "Campos de Envio: o Mercado Livre tentou aplicar o modo legado ME1, mas a conta conectada não possui esse modo. Selecione Mercado Envios (ME2) e uma logística disponível para o anúncio.";
  }
  if (message.toLowerCase().includes("conflict")) {
    return "Campo Família do produto: o Mercado Livre encontrou conflito com a família/cadastro do produto. Altere a família para um nome mais específico, usando marca, modelo e referência exata.";
  }
  if (message.includes("[family_name]")) {
    return "Campo Família do produto: o Mercado Livre exigiu a família do produto. O ERP já envia esse campo automaticamente; tente publicar novamente.";
  }
  if (message.includes("fields [title]") || message.includes("[title]")) {
    return "Campo Título do anúncio: o Mercado Livre rejeitou o título. Em anúncios User Products o ERP não envia título livre; ele é gerado pela família e pelos atributos.";
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

  if (message.includes("[family_name]")) {
    return "O Mercado Livre exigiu a família do produto. O ERP já envia esse campo automaticamente; tente publicar novamente.";
  }

  if (message.includes("body.invalid_fields")) {
    return "O Mercado Livre recusou um ou mais campos do anúncio. Revise família do produto, envio, dimensões, garantia e atributos obrigatórios da categoria.";
  }
  if (message.includes("fields [title]") || message.includes("[title]")) {
    return "O Mercado Livre rejeitou o título neste modelo de família do produto. O ERP vai tentar publicar sem enviar o título livre, deixando o Mercado Livre gerar o título pelo cadastro da família.";
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
