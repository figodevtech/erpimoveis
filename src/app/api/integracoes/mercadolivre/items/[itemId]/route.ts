import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess, requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  mercadoLivreApiGet,
  mercadoLivreApiPost,
  mercadoLivreApiPut,
} from "@/lib/integrations/mercadolivre";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { buildMercadoLivrePackageAttributes } from "@/lib/integrations/mercadolivre-listing-validation";
import {
  getMercadoLivreEditPictureRequirement,
  mercadoLivrePictureRequirementMessage,
  parseMercadoLivrePictureUrls,
} from "@/lib/integrations/mercadolivre-listing-pictures";
import { uploadMercadoLivrePictures } from "@/lib/integrations/mercadolivre-pictures";
import { validateMercadoLivreShippingSelection } from "@/lib/integrations/mercadolivre-shipping-preferences";
import { getMercadoLivrePriceState } from "@/lib/integrations/mercadolivre-price-sync";
import {
  registerMercadoLivreOutboundTouch,
  type MercadoLivreOutboundTouchKind,
} from "@/lib/integrations/mercadolivre-outbound-touch";
import { mercadoLivreVideoInput, normalizeMercadoLivreVideoId } from "@/lib/integrations/mercadolivre-video";
import { buildMercadoLivreEditConfirmations } from "@/lib/integrations/mercadolivre-listing-change";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParamsCtx = { params: Promise<{ itemId: string }> };

export async function GET(_req: NextRequest, ctx: ParamsCtx) {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const { itemId } = await ctx.params;
    const link = await getLink(itemId, empresaId);
    const account = await getValidMercadoLivreAccount(link.empresa_id);
    const accessToken = account.access_token;

    const [item, description] = await Promise.all([
      mercadoLivreApiGet<any>(accessToken, `/items/${encodeURIComponent(itemId)}`),
      mercadoLivreApiGet<any>(accessToken, `/items/${encodeURIComponent(itemId)}/description`).catch(() => null),
    ]);
    const priceState = await getMercadoLivrePriceState(accessToken, itemId, item);
    const userProduct = item?.user_product_id
      ? await mercadoLivreApiGet<any>(accessToken, `/user-products/${encodeURIComponent(String(item.user_product_id))}`).catch(() => null)
      : null;

    const family = userProduct?.family_id
      ? await mercadoLivreApiGet<any>(
          accessToken,
          `/sites/${encodeURIComponent(account.site_id || "MLB")}/user-products-families/${encodeURIComponent(String(userProduct.family_id))}`,
        ).catch(() => null)
      : null;
    const normalized = {
      ...normalizeItemForEdit(item, description, userProduct, family, link),
      price: priceState.standardPrice ?? Number(item?.price ?? 0),
      salePrice: priceState.salePrice,
      regularPrice: priceState.regularPrice,
      pricing: priceState,
      capabilities: getEditCapabilities(item, priceState.automationActive),
    };

    await supabaseAdmin
      .from("mercadolivre_product_link")
      .update({
        status: item?.status ?? null,
        title: item?.title ?? link.title,
        permalink: item?.permalink ?? link.permalink,
        user_product_id: item?.user_product_id ?? null,
        family_id: userProduct?.family_id ?? item?.family_id ?? null,
        family_name: item?.family_name ?? userProduct?.family_name ?? null,
        domain_id: item?.domain_id ?? userProduct?.domain_id ?? null,
        catalog_product_id: item?.catalog_product_id ?? userProduct?.catalog_product_id ?? null,
        user_product_enabled: Boolean(item?.family_name || item?.user_product_id),
        item_tags: Array.isArray(item?.tags) ? item.tags : [],
        raw_item: userProduct ? { ...item, _erp_user_product: userProduct } : item ?? {},
        updated_at: new Date().toISOString(),
      })
      .eq("id", link.id);

    return NextResponse.json({ data: normalized });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/items/[itemId]", e);
    return NextResponse.json({ error: e?.message || "Falha ao carregar anúncio Mercado Livre." }, { status: errorStatus(e) });
  }
}

export async function PATCH(req: NextRequest, ctx: ParamsCtx) {
  let editLogId: number | null = null;
  try {
    await requireVendasEdit();
    const empresaId = await requireEmpresaId();
    const { itemId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "").toLowerCase();
    const effectiveBody =
      action === "update_listing" && body?.changes && typeof body.changes === "object"
        ? body.changes
        : body;

    const link = await getLink(itemId, empresaId);
    const account = await getValidMercadoLivreAccount(link.empresa_id);
    const accessToken = account.access_token;
    if (action === "update_listing") {
      const { data: editLog } = await supabaseAdmin
        .from("mercadolivre_listing_edit_log")
        .insert({
          empresa_id: link.empresa_id,
          product_link_id: link.id,
          produto_id: link.produto_id,
          ml_item_id: itemId.toUpperCase(),
          status: "PROCESSANDO",
          requested_changes: effectiveBody,
        })
        .select("id")
        .maybeSingle();
      editLogId = editLog?.id ? Number(editLog.id) : null;
    }

    if (action === "delete") {
      const item = await deleteMercadoLivreItem(accessToken, itemId);
      await registerMercadoLivreOutboundTouch({
        empresaId: link.empresa_id,
        itemId,
        kinds: "STATUS",
        origin: "PATCH /items/[itemId] delete",
      });
      // Excluído é fim de linha: o anúncio não reativa nem republica. Guardar o
      // vínculo só serviria para ocupar o produto — `unique (empresa_id,
      // produto_id)` impediria anunciá-lo de novo — então ele sai junto, sem
      // esperar a varredura da hora seguinte confirmar o que já sabemos aqui.
      const { error: unlinkError } = await supabaseAdmin
        .from("mercadolivre_product_link")
        .delete()
        .eq("id", link.id);
      if (unlinkError) throw unlinkError;

      console.info("mercado-livre vínculo removido", {
        empresa_id: link.empresa_id,
        produto_id: link.produto_id,
        ml_item_id: itemId.toUpperCase(),
        reason: "Anúncio excluído pelo ERP.",
      });
      return NextResponse.json({ data: item, status: item?.status ?? "closed", deleted: true, unlinked: true });
    }

    if (action === "relist") {
      const relisted = await relistMercadoLivreItem(accessToken, itemId, link);
      await registerMercadoLivreOutboundTouch({
        empresaId: link.empresa_id,
        itemId: String(relisted.item?.id ?? itemId),
        kinds: ["ANUNCIO", "STATUS"],
        origin: "PATCH /items/[itemId] relist",
      });
      return NextResponse.json({
        data: relisted.item,
        status: relisted.item?.status ?? null,
        relistedItemId: relisted.item?.id ?? null,
        previousItemId: itemId.toUpperCase(),
      });
    }

    let payload: Record<string, unknown>;
    let currentItemBefore: any = null;
    if (action === "pause") payload = { status: "paused" };
    else if (action === "activate") payload = { status: "active" };
    else if (action === "close") payload = { status: "closed" };
    else if (action === "update_listing") {
      const currentItem = await mercadoLivreApiGet<any>(accessToken, `/items/${encodeURIComponent(itemId)}`);
      currentItemBefore = currentItem;
      const priceState = await getMercadoLivrePriceState(accessToken, itemId, currentItem);
      const capabilities = getEditCapabilities(currentItem, priceState.automationActive);
      const pictureRequirement = getMercadoLivreEditPictureRequirement({
        currentPictures: currentItem?.pictures,
        pictureUrlProvided: hasOwn(effectiveBody, "pictureUrl"),
        pictureUrl: effectiveBody?.pictureUrl,
      });
      if (!pictureRequirement.valid) {
        throw imageFieldError(mercadoLivrePictureRequirementMessage(pictureRequirement.count));
      }
      if (effectiveBody?.price !== undefined && !capabilities.price) {
        throw fieldRestriction(
          "price",
          "O preço deste anúncio é controlado pela automação do Mercado Livre. Desative a automação no Mercado Livre antes de alterar o preço pelo ERP.",
        );
      }
      if (effectiveBody?.title !== undefined && !capabilities.title) {
        throw fieldRestriction("title", "O título é controlado pelo catálogo/família do Mercado Livre e não pode ser alterado neste anúncio.");
      }
      if (effectiveBody?.availableQuantity !== undefined && !capabilities.stock) {
        throw fieldRestriction(
          "availableQuantity",
          "O estoque deste anúncio é administrado pela logística do Mercado Livre (Full/multiorigem) e não pode ser alterado diretamente pelo ERP.",
        );
      }
      if (effectiveBody?.pictureUrl !== undefined && !capabilities.pictures) {
        throw fieldRestriction("images", "As imagens deste anúncio são controladas pelo catálogo do Mercado Livre.");
      }
      const shippingMode = String(effectiveBody?.shippingMode ?? currentItem?.shipping?.mode ?? "").trim();
      const shippingSelectionChanged = hasOwn(effectiveBody, "shippingMode") || hasOwn(effectiveBody, "logisticType");
      if (shippingSelectionChanged && shippingMode === "me2") {
        const categoryId = String(currentItem?.category_id ?? "").trim();
        if (!categoryId) throw new Error("O anúncio não possui categoria para validar o Mercado Envios.");
        await validateMercadoLivreShippingSelection(account, categoryId, shippingMode);
      }
      const userProductEnabled = Boolean(currentItem?.family_name || currentItem?.user_product_id);
      payload = buildListingUpdatePayload(effectiveBody, userProductEnabled);
      if (effectiveBody?.pictureUrl !== undefined) {
        const pictureSources = parseMercadoLivrePictureUrls(String(effectiveBody.pictureUrl ?? ""));
        payload.pictures = await uploadMercadoLivrePictures(accessToken, pictureSources);
      }
      const familyName = String(effectiveBody?.familyName ?? "").replace(/\s+/g, " ").trim();
      if (userProductEnabled && familyName && familyName !== String(currentItem?.family_name ?? "").trim()) {
        await mercadoLivreApiPut(accessToken, `/items/${encodeURIComponent(itemId)}/family_name`, { family_name: familyName });
      }
    }
    else if (action === "sync_stock") {
      // Só o estoque segue o ERP: o preço do anúncio é independente de `precovenda`.
      const { data: product, error: productError } = await supabaseAdmin
        .from("produto")
        .select("id, estoque")
        .eq("id", link.produto_id)
        .single();

      if (productError) throw productError;
      payload = {
        available_quantity: Math.max(Number((product as any).estoque ?? 0), 0),
      };
    } else {
      return NextResponse.json({ error: "Acao invalida." }, { status: 400 });
    }

    const updatedItem = Object.keys(payload).length
      ? await mercadoLivreApiPut<any>(accessToken, `/items/${encodeURIComponent(itemId)}`, payload)
      : currentItemBefore;

    const description = String(effectiveBody?.description ?? "").trim();
    if (action === "update_listing" && effectiveBody?.description !== undefined) {
      await mercadoLivreApiPut(accessToken, `/items/${encodeURIComponent(itemId)}/description?api_version=2`, {
        plain_text: description,
      }).catch(async () => {
        await mercadoLivreApiPost(accessToken, `/items/${encodeURIComponent(itemId)}/description`, {
          plain_text: description,
        });
      });
    }

    // O Mercado Livre devolve webhooks `items`/`items_prices` por causa das
    // escritas acima. Registrar a autoria impede que a alteração feita aqui
    // dentro volte como aviso de "anúncio atualizado" para quem a fez.
    await registerMercadoLivreOutboundTouch({
      empresaId: link.empresa_id,
      itemId,
      kinds: outboundTouchKinds(action, effectiveBody),
      origin: `PATCH /items/[itemId] ${action}`,
    });

    const item = await mercadoLivreApiGet<any>(accessToken, `/items/${encodeURIComponent(itemId)}`).catch(() => updatedItem);
    const confirmedDescription =
      action === "update_listing" && effectiveBody?.description !== undefined
        ? await mercadoLivreApiGet<any>(accessToken, `/items/${encodeURIComponent(itemId)}/description`).catch(() => null)
        : null;
    const confirmedPriceState =
      action === "update_listing" && effectiveBody?.price !== undefined
        ? await getMercadoLivrePriceState(accessToken, itemId, item)
        : null;
    const confirmations =
      action === "update_listing"
        ? buildMercadoLivreEditConfirmations(effectiveBody, item, confirmedDescription, confirmedPriceState)
        : [];
    const userProduct = item?.user_product_id
      ? await mercadoLivreApiGet<any>(accessToken, `/user-products/${encodeURIComponent(String(item.user_product_id))}`).catch(() => null)
      : null;

    const { error: updateError } = await supabaseAdmin
      .from("mercadolivre_product_link")
      .update({
        status: item?.status ?? null,
        title: item?.title ?? link.title,
        permalink: item?.permalink ?? link.permalink,
        user_product_id: item?.user_product_id ?? null,
        family_id: userProduct?.family_id ?? item?.family_id ?? link.family_id ?? null,
        family_name: item?.family_name ?? userProduct?.family_name ?? link.family_name ?? null,
        domain_id: item?.domain_id ?? userProduct?.domain_id ?? null,
        catalog_product_id: item?.catalog_product_id ?? userProduct?.catalog_product_id ?? null,
        user_product_enabled: Boolean(item?.family_name || item?.user_product_id),
        item_tags: Array.isArray(item?.tags) ? item.tags : [],
        ...(action === "update_listing" && hasPackageDimensionChange(effectiveBody)
          ? packageDimensionSnapshot(effectiveBody)
          : {}),
        raw_item: userProduct ? { ...item, _erp_user_product: userProduct } : item ?? {},
        updated_at: new Date().toISOString(),
      })
      .eq("id", link.id);

    if (updateError) throw updateError;
    if (editLogId) {
      await supabaseAdmin
        .from("mercadolivre_listing_edit_log")
        .update({
          status: confirmations.some((result) => result.status === "DIVERGENTE") ? "PARCIAL" : "SUCESSO",
          confirmed_changes: Object.fromEntries(confirmations.map((result) => [result.field, result.actual])),
          warnings: Array.isArray(updatedItem?.warnings) ? updatedItem.warnings : [],
          completed_at: new Date().toISOString(),
        })
        .eq("id", editLogId);
    }
    return NextResponse.json({
      data: item,
      status: item?.status ?? null,
      confirmations,
      warnings: Array.isArray(updatedItem?.warnings) ? updatedItem.warnings : [],
    });
  } catch (e: any) {
    console.error("PATCH /api/integracoes/mercadolivre/items/[itemId]", e);
    if (editLogId) {
      await supabaseAdmin
        .from("mercadolivre_listing_edit_log")
        .update({
          status: "ERRO",
          error: String(e?.message ?? "Falha ao atualizar anúncio.").slice(0, 2000),
          completed_at: new Date().toISOString(),
        })
        .eq("id", editLogId);
    }
    return NextResponse.json(
      {
        error: e?.message || "Falha ao atualizar anúncio Mercado Livre.",
        fieldErrors: e?.fieldErrors ?? undefined,
        validation: e?.validation ?? undefined,
      },
      { status: Number(e?.status) || errorStatus(e) },
    );
  }
}

/**
 * Exclusão documentada: fecha o anúncio e só então marca `deleted`. Itens em
 * `under_review`/`forbidden` não respondem ao fechamento e aceitam apenas o
 * segundo PUT. O 409 "item optimistic locking error" significa que o Mercado
 * Livre ainda não propagou o fechamento — a documentação manda esperar e repetir.
 */
async function deleteMercadoLivreItem(accessToken: string, itemId: string) {
  const path = `/items/${encodeURIComponent(itemId)}`;
  const current = await mercadoLivreApiGet<any>(accessToken, path).catch(() => null);
  const status = String(current?.status ?? "").toLowerCase();
  const subStatus = (Array.isArray(current?.sub_status) ? current.sub_status : []).map((entry: unknown) =>
    String(entry).toLowerCase(),
  );

  if (subStatus.includes("deleted")) return current;

  const moderationOnly = status === "under_review" && subStatus.includes("forbidden");
  if (!moderationOnly && status !== "closed") {
    await mercadoLivreApiPut(accessToken, path, { status: "closed" });
  }

  let lastError: any = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await mercadoLivreApiPut<any>(accessToken, path, { deleted: true });
    } catch (error: any) {
      lastError = error;
      if (!/optimistic locking|conflict|\b409\b/i.test(String(error?.message ?? ""))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1200 + attempt * 800));
    }
  }
  throw lastError;
}

/**
 * Um anúncio encerrado não volta a ficar ativo: o Mercado Livre só permite
 * republicar, o que cria um item novo com id próprio. O vínculo do produto passa
 * a apontar para esse novo anúncio.
 */
async function relistMercadoLivreItem(accessToken: string, itemId: string, link: any) {
  const path = `/items/${encodeURIComponent(itemId)}`;
  const current = await mercadoLivreApiGet<any>(accessToken, path);
  const status = String(current?.status ?? "").toLowerCase();
  const subStatus = (Array.isArray(current?.sub_status) ? current.sub_status : []).map((entry: unknown) =>
    String(entry).toLowerCase(),
  );

  if (subStatus.includes("deleted")) {
    throw fieldRestriction("general", "Este anúncio foi excluído no Mercado Livre e não pode ser republicado.");
  }
  if (status !== "closed") {
    throw fieldRestriction("general", "Só é possível republicar um anúncio já finalizado.");
  }

  const { data: product } = await supabaseAdmin
    .from("produto")
    .select("estoque")
    .eq("id", link.produto_id)
    .maybeSingle();

  // O preço do anúncio é independente do cadastro: republica com o preço que o anúncio já tinha.
  const price = Number(current?.price ?? 0);
  const quantity = Math.max(Math.trunc(Number(product?.estoque ?? 0)), 0);
  if (!Number.isFinite(price) || price <= 0) {
    throw fieldRestriction("price", "O Mercado Livre não informou o preço do anúncio encerrado.");
  }
  if (quantity <= 0) {
    throw fieldRestriction("stock", "Não é possível republicar um anúncio sem estoque disponível.");
  }

  const item = await mercadoLivreApiPost<any>(accessToken, `${path}/relist`, {
    price,
    quantity,
    listing_type_id: current?.listing_type_id ?? "gold_special",
  });

  if (!item?.id) throw new Error("O Mercado Livre não retornou o código do anúncio republicado.");

  await supabaseAdmin
    .from("mercadolivre_product_link")
    .update({
      ml_item_id: String(item.id),
      status: item?.status ?? null,
      title: item?.title ?? link.title,
      permalink: item?.permalink ?? null,
      item_tags: Array.isArray(item?.tags) ? item.tags : [],
      raw_item: item ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq("id", link.id);

  return { item };
}

function normalizeItemForEdit(item: any, description: any, userProduct?: any, family?: any, link?: any) {
  const saleTerms = Array.isArray(item?.sale_terms) ? item.sale_terms : [];
  const warrantyType = saleTerms.find((term: any) => term?.id === "WARRANTY_TYPE");
  const warrantyTime = saleTerms.find((term: any) => term?.id === "WARRANTY_TIME");
  const shipping = item?.shipping ?? {};
  const dimensions = parseDimensions(shipping?.dimensions);
  const dynamicAttributes: Record<string, string> = {};
  for (const attribute of Array.isArray(item?.attributes) ? item.attributes : []) {
    const id = String(attribute?.id ?? "").toUpperCase();
    if (!id) continue;
    if (attribute?.value_struct?.number != null) {
      dynamicAttributes[id] = String(attribute.value_struct.number);
      if (attribute.value_struct.unit) dynamicAttributes[`${id}__unit`] = String(attribute.value_struct.unit);
    } else {
      dynamicAttributes[id] = String(attribute?.value_name ?? attribute?.value_id ?? "");
    }
  }
  const familyMembers = Array.isArray(family?.user_products)
    ? family.user_products
    : Array.isArray(family?.results)
      ? family.results
      : [];

  return {
    id: item?.id ?? "",
    title: item?.title ?? "",
    familyName: item?.family_name ?? userProduct?.family_name ?? "",
    familyId: userProduct?.family_id ?? item?.family_id ?? null,
    userProductId: item?.user_product_id ?? null,
    userProductEnabled: Boolean(item?.family_name || item?.user_product_id),
    domainId: item?.domain_id ?? userProduct?.domain_id ?? null,
    dynamicAttributes,
    familyMembers: familyMembers.map((member: any) => ({
      id: typeof member === "string" ? member : member?.id ?? member?.user_product_id ?? null,
      name: typeof member === "string" ? null : member?.name ?? member?.title ?? member?.family_name ?? null,
      attributes: typeof member === "string" ? [] : member?.attributes ?? [],
      pictures: typeof member === "string" ? [] : member?.pictures ?? [],
    })),
    price: Number(item?.price ?? 0),
    availableQuantity: Number(item?.available_quantity ?? 0),
    status: item?.status ?? null,
    permalink: item?.permalink ?? null,
    categoryId: item?.category_id ?? null,
    listingTypeId: item?.listing_type_id ?? null,
    condition: item?.condition ?? null,
    description: description?.plain_text ?? description?.text ?? "",
    videoUrl: mercadoLivreVideoInput(item?.video_id),
    pictures: Array.isArray(item?.pictures)
      ? item.pictures.map((picture: any) => picture?.secure_url || picture?.url || picture?.source).filter(Boolean)
      : [],
    warranty: warrantyType?.value_name ?? warrantyType?.value_id ?? "",
    warrantyTime: warrantyTime?.value_name ?? "",
    shippingMode: shipping?.mode ?? "",
    logisticType: shipping?.logistic_type ?? "",
    freeShipping: Boolean(shipping?.free_shipping),
    localPickup: Boolean(shipping?.local_pick_up),
    widthCm: dimensions.widthCm || measurementNumberText(dynamicAttributes.SELLER_PACKAGE_WIDTH) || numberText(link?.package_width_cm),
    heightCm: dimensions.heightCm || measurementNumberText(dynamicAttributes.SELLER_PACKAGE_HEIGHT) || numberText(link?.package_height_cm),
    lengthCm: dimensions.lengthCm || measurementNumberText(dynamicAttributes.SELLER_PACKAGE_LENGTH) || numberText(link?.package_length_cm),
    weightGrams: dimensions.weightGrams || measurementNumberText(dynamicAttributes.SELLER_PACKAGE_WEIGHT) || numberText(link?.package_weight_grams),
  };
}

function numberText(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? String(number) : "";
}

function measurementNumberText(value: unknown) {
  const match = String(value ?? "").trim().match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return "";
  return numberText(match[0].replace(",", "."));
}

function hasOwn(value: unknown, key: string) {
  return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));
}

/**
 * Descreve o que esta edição tocou no anúncio, para que o webhook devolvido pelo
 * Mercado Livre seja reconhecido como eco do próprio ERP.
 */
function outboundTouchKinds(action: string, body: unknown): MercadoLivreOutboundTouchKind[] {
  if (action === "pause" || action === "activate" || action === "close") return ["STATUS"];
  if (action === "sync_stock") return ["ESTOQUE"];

  const kinds = new Set<MercadoLivreOutboundTouchKind>(["ANUNCIO"]);
  if (hasOwn(body, "price")) kinds.add("PRECO");
  if (hasOwn(body, "availableQuantity")) kinds.add("ESTOQUE");
  if (hasOwn(body, "description")) kinds.add("DESCRICAO");
  if (hasOwn(body, "pictureUrl")) kinds.add("FOTOS");
  return Array.from(kinds);
}

function hasPackageDimensionChange(body: unknown) {
  return ["lengthCm", "widthCm", "heightCm", "weightGrams"].some((key) => hasOwn(body, key));
}

function packageDimensionSnapshot(body: any) {
  const length = Number(body?.lengthCm);
  const width = Number(body?.widthCm);
  const height = Number(body?.heightCm);
  const weight = Math.trunc(Number(body?.weightGrams));
  return {
    package_length_cm: Number.isFinite(length) && length > 0 ? length : null,
    package_width_cm: Number.isFinite(width) && width > 0 ? width : null,
    package_height_cm: Number.isFinite(height) && height > 0 ? height : null,
    package_weight_grams: Number.isInteger(weight) && weight > 0 ? weight : null,
  };
}

function parseDimensions(value: unknown) {
  const empty = { lengthCm: "", widthCm: "", heightCm: "", weightGrams: "" };
  const text = String(value ?? "").trim();
  const match = text.match(/^([\d.]+)x([\d.]+)x([\d.]+),(\d+)$/);
  if (!match) return empty;

  return {
    lengthCm: match[1] ?? "",
    widthCm: match[2] ?? "",
    heightCm: match[3] ?? "",
    weightGrams: match[4] ?? "",
  };
}

function buildListingUpdatePayload(body: any, userProductEnabled: boolean) {
  const payload: Record<string, unknown> = {};
  const title = String(body?.title ?? "").trim();
  const price = Number(body?.price);
  const availableQuantity = Math.trunc(Number(body?.availableQuantity));
  const warranty = String(body?.warranty ?? "").trim();
  const warrantyTime = String(body?.warrantyTime ?? "").trim();
  const shippingMode = String(body?.shippingMode ?? "").trim();
  const logisticType = String(body?.logisticType ?? "").trim();
  const freeShipping = Boolean(body?.freeShipping);
  const widthCm = Number(body?.widthCm);
  const heightCm = Number(body?.heightCm);
  const lengthCm = Number(body?.lengthCm);
  const weightGrams = Math.trunc(Number(body?.weightGrams));
  const shippingModeProvided = hasOwn(body, "shippingMode");
  const logisticTypeProvided = hasOwn(body, "logisticType");
  const packageDimensionsProvided = hasPackageDimensionChange(body);

  if (body?.videoUrl !== undefined) payload.video_id = normalizeMercadoLivreVideoId(body.videoUrl);

  if (shippingModeProvided && shippingMode && shippingMode !== "me2") {
    throw fieldRestriction("shippingMode", "O ERP mantém anúncios apenas com Mercado Envios habilitado.");
  }
  if ((shippingModeProvided || logisticTypeProvided) && shippingMode === "me2" && !logisticType) {
    throw fieldRestriction("logisticType", "Selecione a logística do Mercado Envios.");
  }
  if (
    packageDimensionsProvided &&
    (![widthCm, heightCm, lengthCm].every((value) => Number.isFinite(value) && value > 0) || !Number.isInteger(weightGrams) || weightGrams <= 0)
  ) {
    throw fieldRestriction("shippingDimensions", "Informe dimensões e peso para calcular o Mercado Envios.");
  }

  if (title && !userProductEnabled) payload.title = title;
  if (Number.isFinite(price) && price > 0) payload.price = price;
  if (Number.isInteger(availableQuantity) && availableQuantity >= 0) payload.available_quantity = availableQuantity;

  const saleTerms = [
    warranty ? { id: "WARRANTY_TYPE", value_name: warranty } : null,
    warranty && warranty !== "Sem garantia" && warrantyTime ? { id: "WARRANTY_TIME", value_name: warrantyTime } : null,
  ].filter(Boolean);
  if (saleTerms.length) payload.sale_terms = saleTerms;

  if (shippingModeProvided || hasOwn(body, "freeShipping") || hasOwn(body, "localPickup")) {
    const shipping: Record<string, unknown> = {};
    if (shippingModeProvided && shippingMode) shipping.mode = shippingMode;
    if (hasOwn(body, "freeShipping")) shipping.free_shipping = freeShipping;
    if (hasOwn(body, "localPickup")) shipping.local_pick_up = Boolean(body.localPickup);
    payload.shipping = shipping;
  }

  const attributesById = new Map<string, any>();
  const dynamicAttributes = body?.attributes && typeof body.attributes === "object" ? body.attributes : {};
  const definitions = new Map(
    (Array.isArray(body?.attributeDefinitions) ? body.attributeDefinitions : []).map((definition: any) => [String(definition?.id ?? "").toUpperCase(), definition]),
  );
  for (const [rawId, rawValue] of Object.entries(dynamicAttributes)) {
    const id = rawId.toUpperCase();
    if (!id || id.endsWith("__UNIT") || String(rawValue ?? "").trim() === "") continue;
    const definition: any = definitions.get(id);
    const valueName = String(rawValue).trim();
    if (definition?.valueType === "number_unit") {
      const number = Number(valueName.replace(",", "."));
      const unit = String(dynamicAttributes[`${id}__unit`] ?? definition?.defaultUnit ?? definition?.allowedUnits?.[0]?.id ?? "").trim();
      if (Number.isFinite(number) && unit) attributesById.set(id, { id, value_struct: { number, unit } });
      continue;
    }
    const option = definition?.values?.find((candidate: any) => candidate?.id === valueName || candidate?.name === valueName);
    attributesById.set(id, option?.id ? { id, value_id: option.id, value_name: option.name ?? valueName } : { id, value_name: valueName });
  }

  if (packageDimensionsProvided) {
    const packageAttributes = buildMercadoLivrePackageAttributes({
      shippingMode: shippingMode || "me2",
      widthCm,
      heightCm,
      lengthCm,
      weightGrams,
    });
    for (const attribute of packageAttributes) attributesById.set(attribute.id, attribute);
  }
  if (attributesById.size) payload.attributes = Array.from(attributesById.values());

  return payload;
}

function getEditCapabilities(item: any, automationActive: boolean) {
  const catalogControlled = Boolean(item?.catalog_listing || item?.catalog_product_id);
  const familyControlled = Boolean(item?.family_name || item?.user_product_id);
  return {
    price: !automationActive,
    stock: !hasWarehouseManagedStock(item),
    title: !catalogControlled && !familyControlled,
    pictures: !catalogControlled,
    description: true,
    familyName: familyControlled,
  };
}

function hasWarehouseManagedStock(item: any) {
  const tags = Array.isArray(item?.tags) ? item.tags.map((tag: unknown) => String(tag).toLowerCase()) : [];
  return tags.includes("warehouse_management") || tags.includes("meli_facility");
}

function fieldRestriction(field: string, message: string) {
  const error = new Error(message);
  (error as any).status = 422;
  (error as any).fieldErrors = { [field]: message };
  return error;
}

function imageFieldError(message: string) {
  const error = new Error(message);
  (error as any).status = 422;
  (error as any).fieldErrors = { images: message };
  return error;
}

async function getLink(itemId: string, empresaId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_product_link")
    .select("id, empresa_id, produto_id, ml_item_id, title, permalink, user_product_id, family_id, family_name, package_length_cm, package_width_cm, package_height_cm, package_weight_grams")
    .eq("empresa_id", empresaId)
    .eq("ml_item_id", itemId.toUpperCase())
    .single();

  if (error) throw error;
  return data as {
    id: number;
    empresa_id: number;
    produto_id: number;
    ml_item_id: string;
    title?: string | null;
    permalink?: string | null;
    user_product_id?: string | null;
    family_id?: string | null;
    family_name?: string | null;
    package_length_cm?: number | null;
    package_width_cm?: number | null;
    package_height_cm?: number | null;
    package_weight_grams?: number | null;
  };
}
