import { NextResponse } from "next/server";
import { requireVendasEdit } from "@/app/api/_authz/perms";
import { mercadoLivreApiGet, mercadoLivreApiPost, mercadoLivreApiPut } from "@/lib/integrations/mercadolivre";
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
    if (!["new", "used", "not_specified"].includes(condition)) {
      return NextResponse.json({ error: "Condição inválida." }, { status: 400 });
    }

    const pictures = parsePictureUrls(pictureUrl);
    if (!pictures.length) {
      return NextResponse.json({ error: "Informe ao menos uma imagem pública válida para o anúncio." }, { status: 400 });
    }

    if (!["me2", "custom", "pickup"].includes(shippingMode)) {
      return NextResponse.json({ error: "O ERP publica anúncios apenas com Mercado Envios habilitado." }, { status: 400 });
    }
    if (shippingMode === "me2" && !logisticType) {
      return NextResponse.json({ error: "Selecione a logística do Mercado Envios." }, { status: 400 });
    }
    if (shippingMode === "me2" && (![widthCm, heightCm, lengthCm].every((value) => Number.isFinite(value) && value > 0) || !Number.isInteger(weightGrams) || weightGrams <= 0)) {
      return NextResponse.json({ error: "Informe dimensões e peso para calcular o Mercado Envios." }, { status: 400 });
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

    const account = await getDefaultAccount();

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

    const itemPayload: Record<string, unknown> = {
      title,
      category_id: categoryId,
      price,
      currency_id: "BRL",
      available_quantity: availableQuantity,
      buying_mode: "buy_it_now",
      condition,
      listing_type_id: listingTypeId,
      pictures,
      family_name: buildFamilyName({ title, brand, model, partNumber, familyName }),
    };

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

    const item = await createMercadoLivreItem(account.access_token, itemPayload);
    if (!item?.id) {
      return NextResponse.json({ error: "Mercado Livre não retornou o código do anúncio criado." }, { status: 502 });
    }

    const verifiedItem = shippingMode === "me2" ? await verifyMercadoEnviosOrClose(account.access_token, item.id) : item;

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
          title: verifiedItem.title ?? item.title ?? title,
          permalink: verifiedItem.permalink ?? item.permalink ?? null,
          status: verifiedItem.status ?? item.status ?? null,
          raw_item: verifiedItem ?? item ?? {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: "empresa_id,produto_id" },
      )
      .select("id, empresa_id, produto_id, ml_item_id, ml_variation_id, title, permalink, status, updated_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ data, item: verifiedItem });
  } catch (e: any) {
    console.error("POST /api/integracoes/mercadolivre/items", e);
    return NextResponse.json({ error: formatMercadoLivreError(e) || "Falha ao criar anúncio Mercado Livre." }, { status: 500 });
  }
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
    })
    .map((source) => ({ source }));
}

function normalizeBooleanValue(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "sim", "yes", "1"].includes(normalized)) return "Sim";
  if (["false", "não", "nao", "no", "0"].includes(normalized)) return "Não";
  return String(value ?? "").trim();
}

function isValidGtin(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return [8, 12, 13, 14].includes(digits.length);
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

  const shipping: Record<string, unknown> = {
    mode: params.shippingMode,
    free_shipping: params.freeShipping,
    local_pick_up: false,
  };

  if (params.logisticType) shipping.logistic_type = params.logisticType;
  if ([params.widthCm, params.heightCm, params.lengthCm].every((value) => Number.isFinite(value) && value > 0) && Number.isInteger(params.weightGrams) && params.weightGrams > 0) {
    shipping.dimensions = `${params.lengthCm}x${params.widthCm}x${params.heightCm},${params.weightGrams}`;
  }

  return shipping;
}

async function verifyMercadoEnviosOrClose(accessToken: string, itemId: string) {
  const item = await mercadoLivreApiGet<any>(accessToken, `/items/${encodeURIComponent(itemId)}`);
  const shipping = item?.shipping ?? {};
  const mode = String(shipping?.mode ?? "").toLowerCase();
  const logisticType = String(shipping?.logistic_type ?? "").toLowerCase();
  const localPickup = Boolean(shipping?.local_pick_up);

  if (mode === "me2" && !localPickup) return item;

  await mercadoLivreApiPut(accessToken, `/items/${encodeURIComponent(itemId)}`, { status: "closed" }).catch(() => null);

  throw new Error(
    [
      "O Mercado Livre criou o anúncio sem Mercado Envios e ele foi encerrado automaticamente pelo ERP.",
      `Modo retornado: ${mode || "não informado"}.`,
      logisticType ? `Logística retornada: ${logisticType}.` : "",
      localPickup ? "Retirada local veio habilitada." : "",
      "Revise o cadastro do vendedor no Mercado Livre, endereço de origem, categoria e se a conta de teste está habilitada para Mercado Envios.",
    ]
      .filter(Boolean)
      .join(" "),
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

async function createMercadoLivreItem(accessToken: string, payload: Record<string, unknown>) {
  try {
    return await mercadoLivreApiPost<MercadoLivreCreatedItem>(accessToken, "/items", payload);
  } catch (firstError) {
    if (isInvalidGtinError(firstError) && Array.isArray(payload.attributes)) {
      const withoutGtinPayload = {
        ...payload,
        attributes: payload.attributes.filter((attribute: any) => String(attribute?.id ?? "").toUpperCase() !== "GTIN"),
      };

      try {
        return await mercadoLivreApiPost<MercadoLivreCreatedItem>(accessToken, "/items", withoutGtinPayload);
      } catch (withoutGtinError) {
        payload = withoutGtinPayload;
        firstError = withoutGtinError;
      }
    }

    if (payload.family_name && isInvalidTitleError(firstError)) {
      const familyPayload = { ...payload };
      delete familyPayload.title;
      if (Array.isArray(familyPayload.attributes)) {
        familyPayload.attributes = familyPayload.attributes.filter((attribute: any) => String(attribute?.id ?? "").toUpperCase() !== "GTIN");
      }

      try {
        return await mercadoLivreApiPost<MercadoLivreCreatedItem>(accessToken, "/items", familyPayload);
      } catch (familyError: any) {
        throw new Error(
          `Mercado Livre recusou o título no modelo de família do produto. Com título: ${formatMercadoLivreError(firstError)}. Sem título: ${formatMercadoLivreError(familyError)}.`,
        );
      }
    }

    if (!payload.family_name || !isMissingFamilyNameError(firstError)) throw firstError;

    const fallbackPayload = { ...payload };
    fallbackPayload.family_name = String(payload.title ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

    try {
      return await mercadoLivreApiPost<MercadoLivreCreatedItem>(accessToken, "/items", fallbackPayload);
    } catch (secondError: any) {
      throw new Error(
        `Mercado Livre recusou a publicação com e sem família do produto. Com família: ${formatMercadoLivreError(firstError)}. Sem família: ${formatMercadoLivreError(secondError)}.`,
      );
    }
  }
}

function isMissingFamilyNameError(error: unknown) {
  const message = String((error as any)?.message ?? "");
  return message.includes("[family_name]") || message.includes("family_name");
}

function isInvalidTitleError(error: unknown) {
  const message = String((error as any)?.message ?? "");
  return message.includes("[title]") || message.includes("fields [title]") || message.includes("title");
}

function isInvalidGtinError(error: unknown) {
  const message = String((error as any)?.message ?? "");
  return message.includes("[GTIN]") || message.includes("GTIN");
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
  if (message.toLowerCase().includes("conflict")) {
    return "Campo Família do produto: o Mercado Livre encontrou conflito com a família/cadastro do produto. Altere a família para um nome mais específico, usando marca, modelo e referência exata.";
  }
  if (message.includes("[family_name]")) {
    return "Campo Família do produto: o Mercado Livre exigiu a família do produto. O ERP já envia esse campo automaticamente; tente publicar novamente.";
  }
  if (message.includes("fields [title]") || message.includes("[title]")) {
    return "Campo Título do anúncio: o Mercado Livre rejeitou o título neste modelo de família do produto. O ERP tenta publicar sem enviar o título livre, deixando o Mercado Livre gerar o título pelo cadastro da família.";
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

async function getDefaultAccount() {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, access_token")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (error) throw error;
  return data as { id: number; empresa_id: number; access_token: string };
}
