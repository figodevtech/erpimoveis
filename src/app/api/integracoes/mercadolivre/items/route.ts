import { NextResponse } from "next/server";
import { requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { mercadoLivreApiGet, mercadoLivreApiPost, mercadoLivreApiPut } from "@/lib/integrations/mercadolivre";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { registerMercadoLivreOutboundTouch } from "@/lib/integrations/mercadolivre-outbound-touch";
import {
  assertMercadoLivreItemIsValid,
  buildMercadoLivreItemPayload,
  collectMercadoLivreListingRequestErrors,
  formatMercadoLivreError,
  parseMercadoLivreListingRequest,
  parsePictureUrls,
} from "@/lib/integrations/mercadolivre-item-payload";
import {
  buildMercadoLivreShippingDimensions,
  mercadoEnviosLogisticLabel,
  verifyMercadoEnviosItem,
} from "@/lib/integrations/mercadolivre-mercado-envios";
import { logMercadoLivreListingPayload } from "@/lib/integrations/mercadolivre-listing-payload-log";
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

export async function POST(req: Request) {
  const errorContext: { shippingMode?: string } = {};
  // Preenchido conforme o anúncio é montado, para que o log de diagnóstico
  // exista mesmo quando o Mercado Livre recusa a criação.
  const attempt: {
    empresaId?: number;
    produtoId?: number;
    mlUserId?: number | string;
    categoryId?: string;
    listingTypeId?: string;
    logisticType?: string;
    freeShipping?: boolean;
    itemPayload?: Record<string, unknown>;
    shippingModesRequest?: unknown;
    shippingModesResponse?: unknown;
  } = {};
  try {
    await requireVendasEdit();
    const empresaId = await requireEmpresaId();
    const body = await req.json().catch(() => ({}));
    const request = parseMercadoLivreListingRequest(body);
    errorContext.shippingMode = request.shippingMode;

    const requestErrors = collectMercadoLivreListingRequestErrors(request);
    if (requestErrors.length) {
      const [first] = requestErrors;
      return NextResponse.json(
        {
          error: first.message,
          fieldErrors: Object.fromEntries(requestErrors.map((issue) => [issue.field, issue.message])),
        },
        { status: first.status },
      );
    }

    const pictureSources = parsePictureUrls(request.pictureUrl);
    const account = await getValidMercadoLivreAccount(empresaId);
    attempt.empresaId = account.empresa_id;
    attempt.produtoId = request.produtoId;
    attempt.mlUserId = account.ml_user_id;
    attempt.categoryId = request.categoryId;
    attempt.listingTypeId = request.listingTypeId;
    attempt.logisticType = request.logisticType;
    attempt.freeShipping = request.freeShipping;
    const seller = await mercadoLivreApiGet<MercadoLivreSeller>(account.access_token, `/users/${account.ml_user_id}`);
    const sellerTags = Array.isArray(seller?.tags) ? seller.tags.map(String) : [];
    const userProductSeller = sellerTags.includes("user_product_seller");
    if (seller.status?.list?.allow === false) {
      throw listingValidationError(
        `A conta Mercado Livre não está autorizada a publicar. ${translateSellerRestrictionCodes(seller.status.list.codes).join(" ")}`.trim(),
        "general",
      );
    }
    await validateListingTypeAvailability(account.access_token, account.ml_user_id, request.categoryId, request.listingTypeId);
    await validateMercadoLivreShippingSelection(account, request.categoryId, request.shippingMode);

    const { data: existingLink, error: linkError } = await supabaseAdmin
      .from("mercadolivre_product_link")
      .select("id, ml_item_id")
      .eq("empresa_id", account.empresa_id)
      .eq("produto_id", request.produtoId)
      .maybeSingle();

    if (linkError) throw linkError;
    if (existingLink?.ml_item_id) {
      return NextResponse.json({ error: "Este produto já possui anúncio Mercado Livre vinculado." }, { status: 409 });
    }
    const pictures = await uploadMercadoLivrePictures(account.access_token, pictureSources);

    const { payload: itemPayload, attributes, saleTerms } = buildMercadoLivreItemPayload({
      ...request,
      pictures,
      userProductSeller,
    });
    attempt.itemPayload = itemPayload;

    if (request.shippingMode === "me2") {
      const shippingModes = await validateMercadoLivreShippingForListing(account, request.shippingMode, request.logisticType, {
        title: request.title,
        categoryId: request.categoryId,
        price: request.price,
        currencyId: "BRL",
        listingTypeId: request.listingTypeId,
        condition: request.condition,
        localPickup: request.localPickup,
        dimensions: buildMercadoLivreShippingDimensions(request),
        saleTerms,
        attributes,
      });
      attempt.shippingModesResponse = shippingModes;
    }

    await assertMercadoLivreItemIsValid(account.access_token, itemPayload, { shippingMode: request.shippingMode });
    const item = await mercadoLivreApiPost<MercadoLivreCreatedItem>(account.access_token, "/items", itemPayload);
    if (!item?.id) {
      return NextResponse.json({ error: "Mercado Livre não retornou o código do anúncio criado." }, { status: 502 });
    }

    await registerMercadoLivreOutboundTouch({
      empresaId: account.empresa_id,
      itemId: item.id,
      kinds: ["ANUNCIO", "PRECO", "ESTOQUE"],
      origin: "POST /items",
    });

    const verifiedItem = await verifyCreatedItemOrClose(account.access_token, item.id, {
      requireMercadoEnvios: request.shippingMode === "me2",
      expectedLogisticType: request.logisticType,
      expectedFreeShipping: request.freeShipping,
      context: {
        empresa_id: account.empresa_id,
        ml_user_id: account.ml_user_id,
        category_id: request.categoryId,
        listing_type_id: request.listingTypeId,
      },
    });
    const userProduct = verifiedItem?.user_product_id
      ? await mercadoLivreApiGet<any>(account.access_token, `/user-products/${encodeURIComponent(String(verifiedItem.user_product_id))}`).catch(() => null)
      : null;
    const enrichedItem = userProduct ? { ...verifiedItem, _erp_user_product: userProduct } : verifiedItem;

    if (request.description) {
      try {
        await mercadoLivreApiPost(account.access_token, `/items/${encodeURIComponent(item.id)}/description`, {
          plain_text: request.description,
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
          produto_id: request.produtoId,
          ml_item_id: item.id,
          title: enrichedItem.title ?? item.title ?? request.title,
          permalink: enrichedItem.permalink ?? item.permalink ?? null,
          status: enrichedItem.status ?? item.status ?? null,
          user_product_id: enrichedItem.user_product_id ?? null,
          family_id: userProduct?.family_id ?? enrichedItem.family_id ?? null,
          family_name: enrichedItem.family_name ?? userProduct?.family_name ?? null,
          domain_id: enrichedItem.domain_id ?? userProduct?.domain_id ?? null,
          catalog_product_id: enrichedItem.catalog_product_id ?? userProduct?.catalog_product_id ?? null,
          user_product_enabled: Boolean(enrichedItem.family_name || enrichedItem.user_product_id),
          item_tags: Array.isArray(enrichedItem.tags) ? enrichedItem.tags : [],
          package_length_cm: request.lengthCm,
          package_width_cm: request.widthCm,
          package_height_cm: request.heightCm,
          package_weight_grams: request.weightGrams,
          raw_item: enrichedItem ?? item ?? {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: "empresa_id,produto_id" },
      )
      .select("id, empresa_id, produto_id, ml_item_id, ml_variation_id, title, permalink, status, updated_at")
      .single();

    if (error) throw error;

    await logMercadoLivreListingPayload({
      empresaId: account.empresa_id,
      produtoId: request.produtoId,
      mlUserId: account.ml_user_id,
      mlItemId: item.id,
      operacao: "CRIACAO",
      status: "SUCESSO",
      categoryId: request.categoryId,
      listingTypeId: request.listingTypeId,
      shippingMode: request.shippingMode,
      logisticType: request.logisticType,
      freeShipping: request.freeShipping,
      itemPayload: itemPayload,
      shippingModesResponse: attempt.shippingModesResponse,
      response: enrichedItem?.shipping ?? null,
    });

    const shippingCheck = verifyMercadoEnviosItem(enrichedItem, {
      expectedLogisticType: request.logisticType,
      expectedFreeShipping: request.freeShipping,
    });

    return NextResponse.json({
      data,
      item: enrichedItem,
      model: userProductSeller ? "user_product" : "legacy",
      shipping: {
        mode: shippingCheck.mode || null,
        logisticType: shippingCheck.logisticType || null,
        logisticLabel: shippingCheck.logisticType ? mercadoEnviosLogisticLabel(shippingCheck.logisticType) : null,
        expectedLogisticType: shippingCheck.expectedLogisticType,
        logisticMismatch: shippingCheck.logisticMismatch,
        freeShipping: shippingCheck.freeShipping,
        notes: shippingCheck.reasons,
      },
    });
  } catch (e: any) {
    console.error("POST /api/integracoes/mercadolivre/items", e);
    if (attempt.empresaId) {
      await logMercadoLivreListingPayload({
        empresaId: attempt.empresaId,
        produtoId: attempt.produtoId,
        mlUserId: attempt.mlUserId,
        operacao: "CRIACAO",
        status: "ERRO",
        categoryId: attempt.categoryId,
        listingTypeId: attempt.listingTypeId,
        shippingMode: errorContext.shippingMode,
        logisticType: attempt.logisticType,
        freeShipping: attempt.freeShipping,
        httpStatus: Number(e?.status) || null,
        itemPayload: attempt.itemPayload ?? {},
        shippingModesRequest: attempt.shippingModesRequest,
        shippingModesResponse: attempt.shippingModesResponse ?? e?.validation ?? null,
        response: e?.validation ?? null,
        error: String(e?.message ?? "").slice(0, 2000),
      });
    }
    return NextResponse.json(
      {
        error: formatMercadoLivreError(e, errorContext) || "Falha ao criar anúncio Mercado Livre.",
        fieldErrors: e?.fieldErrors ?? undefined,
        validation: e?.validation ?? undefined,
      },
      { status: Number(e?.status) || errorStatus(e) },
    );
  }
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

/**
 * Mantém a proteção existente: um anúncio pedido como ME2 que nasce sem Mercado
 * Envios é encerrado automaticamente. Uma logística ME2 diferente da prevista é
 * apenas registrada — não encerra o anúncio.
 */
async function verifyCreatedItemOrClose(
  accessToken: string,
  itemId: string,
  options: {
    requireMercadoEnvios: boolean;
    expectedLogisticType: string;
    expectedFreeShipping: boolean;
    context: Record<string, unknown>;
  },
) {
  let item: any = null;
  const maxAttempts = options.requireMercadoEnvios ? 5 : 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    item = await mercadoLivreApiGet<any>(accessToken, `/items/${encodeURIComponent(itemId)}`);
    const hasPictures = Array.isArray(item?.pictures) && item.pictures.length > 0;
    if (hasPictures && (!options.requireMercadoEnvios || verifyMercadoEnviosItem(item).ok)) break;
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

  if (!options.requireMercadoEnvios) return item;

  const check = verifyMercadoEnviosItem(item, {
    expectedLogisticType: options.expectedLogisticType,
    expectedFreeShipping: options.expectedFreeShipping,
  });

  if (check.ok) {
    if (check.logisticMismatch) {
      console.warn("mercado-envios logistic mismatch", {
        ...options.context,
        ml_item_id: itemId,
        expected_logistic_type: check.expectedLogisticType,
        actual_logistic_type: check.logisticType,
      });
    }
    return item;
  }

  await mercadoLivreApiPut(accessToken, `/items/${encodeURIComponent(itemId)}`, { status: "closed" }).catch(() => null);

  throw listingValidationError(
    [
      "O Mercado Livre criou o anúncio sem Mercado Envios e ele foi encerrado automaticamente pelo ERP.",
      ...check.reasons,
      "Revise o cadastro do vendedor no Mercado Livre, endereço de origem, categoria e se a conta está habilitada para Mercado Envios.",
    ]
      .filter(Boolean)
      .join(" "),
    "shipping",
  );
}
