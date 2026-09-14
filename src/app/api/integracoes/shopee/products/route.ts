import { NextRequest, NextResponse } from "next/server";
import { requireEstoqueAccess, requireEstoqueEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { getShopeeCategoryAttributes, getShopeeLanguage, shopeeShopApi, uploadShopeeImageFromUrl } from "@/lib/integrations/shopee";
import { buildShopeeAttributeList, normalizeShopeeAttribute, normalizeShopeeLogisticsChannel, validateShopeeListingLimits, validateShopeePackage, type ShopeeAttributeDefinition, type ShopeeLogisticsChannel } from "@/lib/integrations/shopee-listing";
import { idDeBusca } from "@/lib/busca-numerica";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RemoteItem = Record<string, any> & { item_id: number; item_name?: string; item_sku?: string; item_status?: string };

export async function GET(request: NextRequest) {
  try {
    await requireEstoqueAccess();
    const empresaId = await requireEmpresaId();
    const search = request.nextUrl.searchParams.get("search")?.trim() || "";
    const refreshRemote = request.nextUrl.searchParams.get("refresh") === "1";
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const limit = Math.min(100, Math.max(10, Number(request.nextUrl.searchParams.get("limit") || 20)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let productQuery = supabaseAdmin
      .from("produto")
      .select("id, titulo, descricao, referencia, precovenda, estoque, status_estoque, tituloMarketplace, descricaoMarketplace, imgUrl, fabricante, codigobarras", { count: "exact" })
      .eq("is_deleted", false)
      .order("id", { ascending: false })
      .range(from, to);
    if (search) {
      const escaped = search.replace(/[,%()]/g, " ").trim();
      if (/^#?\d+$/.test(escaped)) {
        const id = idDeBusca(escaped);
        productQuery = productQuery.or(`${id !== null ? `id.eq.${id},` : ""}titulo.ilike.%${escaped}%,referencia.ilike.%${escaped}%,codigobarras.ilike.%${escaped}%`);
      } else {
        productQuery = productQuery.or(`titulo.ilike.%${escaped}%,referencia.ilike.%${escaped}%,tituloMarketplace.ilike.%${escaped}%,fabricante.ilike.%${escaped}%,codigobarras.ilike.%${escaped}%`);
      }
    }

    const [{ data: products, error: productError, count }, { data: links, error: linkError }] = await Promise.all([
      productQuery,
      supabaseAdmin.from("shopee_product_link").select("*").eq("empresa_id", empresaId).order("updated_at", { ascending: false }),
    ]);
    if (productError) throw productError;
    if (linkError) throw linkError;

    const linkedProductIds = Array.from(new Set((links ?? []).map((link: any) => Number(link.produto_id)).filter(Boolean)));
    const { data: linkedProductRows, error: linkedProductError } = linkedProductIds.length
      ? await supabaseAdmin.from("produto").select("id, titulo, descricao, referencia, precovenda, estoque, status_estoque, imgUrl, fabricante, codigobarras").in("id", linkedProductIds).eq("is_deleted", false)
      : { data: [], error: null };
    if (linkedProductError) throw linkedProductError;

    const productIds = (products ?? []).map((row: any) => Number(row.id));
    const { data: images, error: imageError } = productIds.length
      ? await supabaseAdmin.from("produto_imagem").select("produto_id, url, ordem").in("produto_id", productIds).order("ordem")
      : { data: [], error: null };
    if (imageError) throw imageError;

    let remoteItems: RemoteItem[] = [];
    let remoteError: string | null = null;
    if (refreshRemote) {
      try {
        remoteItems = await loadRemoteItems();
        await reconcileRemoteCatalog(empresaId, products ?? [], links ?? [], remoteItems);
      } catch (error: any) {
        remoteError = friendlyShopeeError(error);
      }
    }

    const refreshedLinks = refreshRemote
      ? (await supabaseAdmin.from("shopee_product_link").select("*").eq("empresa_id", empresaId).order("updated_at", { ascending: false })).data ?? []
      : links ?? [];
    const linkByProduct = new Map(refreshedLinks.map((link: any) => [Number(link.produto_id), link]));
    const imagesByProduct = new Map<number, string[]>();
    for (const image of images ?? []) {
      const id = Number((image as any).produto_id);
      const current = imagesByProduct.get(id) ?? [];
      if ((image as any).url) current.push(String((image as any).url));
      imagesByProduct.set(id, current);
    }

    return NextResponse.json({
      products: (products ?? []).map((product: any) => ({
        ...product,
        imageUrls: Array.from(new Set([product.imgUrl, ...(imagesByProduct.get(Number(product.id)) ?? [])].filter(Boolean))),
        shopee: linkByProduct.get(Number(product.id)) ?? null,
      })),
      linkedProducts: (linkedProductRows ?? []).map((product: any) => ({ ...product, shopee: linkByProduct.get(Number(product.id)) ?? null })),
      remoteItems,
      remoteError,
      pagination: { page, limit, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / limit)) },
    });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyShopeeError(error) || "Falha ao carregar catálogo Shopee." }, { status: errorStatus(error) });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireEstoqueEdit();
    const empresaId = await requireEmpresaId();
    const body = await request.json().catch(() => ({}));
    const produtoId = positiveInteger(body.produtoId);
    const categoryId = positiveInteger(body.categoryId);
    const weight = positiveNumber(body.weight);
    const priceOverride = optionalPositiveNumber(body.price);
    const stockOverride = optionalNonNegativeInteger(body.stock);
    const logisticIds: number[] = Array.from(new Set(Array.isArray(body.logisticIds) ? body.logisticIds.map(positiveInteger).filter(Boolean) : []));
    const condition = String(body.condition || "NEW").toUpperCase();
    if (!produtoId || !categoryId) return NextResponse.json({ error: "Produto e categoria Shopee são obrigatórios." }, { status: 400 });
    if (!weight) return NextResponse.json({ error: "Informe o peso do pacote em kg." }, { status: 400 });
    if (!logisticIds.length) return NextResponse.json({ error: "Selecione ao menos um canal logístico da Shopee." }, { status: 400 });
    if (!["NEW", "USED"].includes(condition)) return NextResponse.json({ error: "A condição do produto deve ser Novo ou Usado." }, { status: 400 });

    const dimension = {
      package_length: positiveNumber(body.length),
      package_width: positiveNumber(body.width),
      package_height: positiveNumber(body.height),
    };
    if (Object.values(dimension).some((value) => !value)) return NextResponse.json({ error: "Informe comprimento, largura e altura do pacote em cm." }, { status: 400 });

    const language = await getShopeeLanguage();
    const rawAttributeDefinitions = await getShopeeCategoryAttributes(categoryId, language);
    const attributeDefinitions: ShopeeAttributeDefinition[] = rawAttributeDefinitions
      .map((attribute: any) => normalizeShopeeAttribute(attribute, language))
      .filter((attribute: ShopeeAttributeDefinition | null): attribute is ShopeeAttributeDefinition => Boolean(attribute));
    const attributeValues = body.attributeValues && typeof body.attributeValues === "object" ? body.attributeValues as Record<string, unknown> : {};
    const requiredMissing = attributeDefinitions
      .filter((attribute) => attribute.required)
      .filter((attribute) => !String(attributeValues[String(attribute.id)] ?? "").trim())
      .map((attribute) => attribute.name);
    if (requiredMissing.length) return NextResponse.json({ error: `Preencha os atributos obrigatórios: ${requiredMissing.join(", ")}.` }, { status: 400 });
    const dynamicAttributeList = buildShopeeAttributeList(attributeDefinitions, attributeValues);

    const logisticsResponse = await shopeeShopApi<any>({ path: "/api/v2/logistics/get_channel_list" });
    const availableChannels: ShopeeLogisticsChannel[] = (logisticsResponse?.response?.logistics_channel_list ?? logisticsResponse?.response?.logistic_channel_list ?? [])
      .map(normalizeShopeeLogisticsChannel)
      .filter((channel: ShopeeLogisticsChannel | null): channel is ShopeeLogisticsChannel => Boolean(channel));
    const selectedChannels = logisticIds
      .map((id) => availableChannels.find((channel) => channel.id === id))
      .filter((channel): channel is NonNullable<typeof channel> => Boolean(channel));
    if (selectedChannels.length !== logisticIds.length) return NextResponse.json({ error: "Um ou mais canais logísticos não estão disponíveis para esta loja." }, { status: 400 });
    const packageErrors = validateShopeePackage({
      weight,
      length: dimension.package_length,
      width: dimension.package_width,
      height: dimension.package_height,
      channels: selectedChannels,
    });
    if (packageErrors.length) return NextResponse.json({ error: packageErrors.join(" ") }, { status: 400 });

    const brandResponse = await shopeeShopApi<any>({ path: "/api/v2/product/get_brand_list", query: { category_id: categoryId, offset: 0, page_size: 100, status: 1 } });
    const brandIdProvided = body.brandId !== undefined && body.brandId !== "";
    const brandId = brandIdProvided ? Number(body.brandId) : null;
    const availableBrands = brandResponse?.response?.brand_list ?? [];
    const selectedBrand = brandIdProvided ? availableBrands.find((brand: any) => Number(brand?.brand_id) === brandId) : null;
    if (brandResponse?.response?.is_mandatory && !brandIdProvided) return NextResponse.json({ error: "Selecione a marca exigida pela categoria (use Sem marca quando aplicável)." }, { status: 400 });
    if (brandIdProvided && !selectedBrand) return NextResponse.json({ error: "A marca selecionada não é válida para esta categoria Shopee." }, { status: 400 });

    const [{ data: product, error: productError }, { data: existing, error: existingError }] = await Promise.all([
      supabaseAdmin.from("produto").select("id, titulo, descricao, referencia, precovenda, estoque, tituloMarketplace, descricaoMarketplace, imgUrl, fabricante, codigobarras").eq("id", produtoId).eq("is_deleted", false).single(),
      supabaseAdmin.from("shopee_product_link").select("id, item_id").eq("empresa_id", empresaId).eq("produto_id", produtoId).maybeSingle(),
    ]);
    if (productError?.code === "PGRST116") {
      return NextResponse.json({ error: "O produto selecionado não existe mais ou foi excluído. Escolha o produto novamente." }, { status: 404 });
    }
    if (productError) throw publicationStageError("consultar o produto no ERP", productError);
    if (existingError) throw publicationStageError("verificar o vínculo do anúncio", existingError);
    if (existing?.item_id) return NextResponse.json({ error: "Este produto já possui anúncio Shopee vinculado." }, { status: 409 });

    const title = String(body.title || product.tituloMarketplace || product.titulo || "").trim();
    const description = String(body.description || product.descricaoMarketplace || product.descricao || title).trim();
    const price = priceOverride ?? Number(product.precovenda);
    const stock = stockOverride ?? Math.max(0, Math.trunc(Number(product.estoque || 0)));
    if (!title || !description || !Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: "Título, descrição e preço válido são obrigatórios." }, { status: 400 });
    }

    const { data: extraImages, error: imagesError } = await supabaseAdmin.from("produto_imagem").select("url").eq("produto_id", produtoId).order("ordem").limit(9);
    if (imagesError) throw publicationStageError("consultar as imagens do produto", imagesError);
    const imageUrls = Array.from(new Set([product.imgUrl, ...(extraImages ?? []).map((row: any) => row.url), ...(Array.isArray(body.imageUrls) ? body.imageUrls : [])].map(String).filter(Boolean))).slice(0, 9);
    if (!imageUrls.length) return NextResponse.json({ error: "Cadastre ao menos uma imagem pública HTTPS no produto." }, { status: 400 });
    const itemLimits = await shopeeShopApi<any>({ path: "/api/v2/product/get_item_limit" });
    const listingLimitErrors = validateShopeeListingLimits({ title, description, price, stock, imageCount: imageUrls.length, limits: itemLimits?.response });
    if (listingLimitErrors.length) return NextResponse.json({ error: listingLimitErrors.join(" ") }, { status: 400 });
    const imageIds: string[] = [];
    for (const [index, url] of imageUrls.entries()) {
      try {
        imageIds.push(await uploadShopeeImageFromUrl(url));
      } catch (error) {
        throw publicationStageError(`preparar a imagem ${index + 1}`, error);
      }
    }

    const payload: Record<string, unknown> = {
      item_name: title,
      description,
      item_sku: String(body.sku || product.referencia || product.id).slice(0, 100),
      category_id: categoryId,
      original_price: price,
      seller_stock: [{ stock }],
      weight,
      dimension,
      condition,
      image: { image_id_list: imageIds },
      logistic_info: logisticIds.map((logisticId: number) => ({ logistic_id: logisticId, enabled: true })),
    };
    if (dynamicAttributeList.length) payload.attribute_list = dynamicAttributeList;
    else if (Array.isArray(body.attributeList) && body.attributeList.length) payload.attribute_list = body.attributeList;
    if (selectedBrand) {
      payload.brand = {
        brand_id: Number(selectedBrand.brand_id),
        original_brand_name: String(selectedBrand.original_brand_name ?? selectedBrand.display_brand_name ?? "").trim(),
      };
    }

    let created: any;
    try {
      created = await shopeeShopApi<any>({ path: "/api/v2/product/add_item", method: "POST", body: payload });
    } catch (error) {
      if (isAmbiguousShopeeItemCreationError(error)) {
        const recovered = await findRemoteItemCreatedBySku(String(payload.item_sku), title).catch(() => null);
        if (recovered) {
          created = {
            response: recovered,
            warning: "A Shopee informou uma falha interna, mas o anúncio foi localizado e vinculado ao ERP.",
          };
        } else {
          throw publicationStageError("enviar o anúncio para a Shopee", error);
        }
      } else {
        throw publicationStageError("enviar o anúncio para a Shopee", error);
      }
    }
    const itemId = Number(created?.response?.item_id);
    if (!itemId) throw new Error("A Shopee não retornou o Item ID do anúncio.");
    const { data: link, error: linkSaveError } = await supabaseAdmin.from("shopee_product_link").upsert({
      empresa_id: empresaId,
      produto_id: produtoId,
      item_id: itemId,
      item_sku: payload.item_sku,
      title,
      status: "NORMAL",
      raw_item: created,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "empresa_id,produto_id" }).select().single();
    if (linkSaveError) throw publicationStageError("salvar o vínculo do anúncio no ERP", linkSaveError);
    return NextResponse.json({ ok: true, item: created.response, link, warning: created.warning ?? null });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyShopeeError(error) || "Falha ao publicar produto na Shopee." }, { status: errorStatus(error) });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireEstoqueEdit();
    const empresaId = await requireEmpresaId();
    const body = await request.json().catch(() => ({}));
    const produtoId = positiveInteger(body.produtoId);
    if (!produtoId) return NextResponse.json({ error: "Produto inválido." }, { status: 400 });
    const { data: link, error } = await supabaseAdmin.from("shopee_product_link").select("*").eq("empresa_id", empresaId).eq("produto_id", produtoId).single();
    if (error) throw error;
    const itemId = Number(link.item_id);
    const modelId = link.model_id ? Number(link.model_id) : undefined;
    const action = String(body.action || "sync");
    const supportedActions = new Set(["sync", "stock", "price", "unlist", "relist", "edit", "delete"]);
    if (!supportedActions.has(action)) return NextResponse.json({ error: "Ação de anúncio Shopee inválida." }, { status: 400 });

    if (action === "delete") {
      await shopeeShopApi({ path: "/api/v2/product/delete_item", method: "POST", body: { item_id: itemId } });
      const { error: deleteLinkError } = await supabaseAdmin.from("shopee_product_link").delete().eq("id", link.id).eq("empresa_id", empresaId);
      if (deleteLinkError) throw publicationStageError("remover o vínculo excluído do ERP", deleteLinkError);
      return NextResponse.json({ ok: true, deleted: true, itemId });
    }

    if (action === "stock" || action === "sync") {
      const stock = optionalNonNegativeInteger(body.stock);
      if (stock === null) return NextResponse.json({ error: "Estoque inválido." }, { status: 400 });
      await shopeeShopApi({ path: "/api/v2/product/update_stock", method: "POST", body: { item_id: itemId, stock_list: [{ ...(modelId ? { model_id: modelId } : {}), normal_stock: stock }] } });
    }
    if (action === "price" || action === "sync") {
      const price = optionalPositiveNumber(body.price);
      if (price === null) return NextResponse.json({ error: "Preço inválido." }, { status: 400 });
      await shopeeShopApi({ path: "/api/v2/product/update_price", method: "POST", body: { item_id: itemId, price_list: [{ ...(modelId ? { model_id: modelId } : {}), original_price: price }] } });
    }
    if (action === "unlist" || action === "relist") {
      await shopeeShopApi({ path: "/api/v2/product/unlist_item", method: "POST", body: { item_id: itemId, unlist: action === "unlist" } });
    }
    if (action === "edit") {
      const updates: Record<string, unknown> = { item_id: itemId };
      if (String(body.title || "").trim()) updates.item_name = String(body.title).trim();
      if (String(body.description || "").trim()) updates.description = String(body.description).trim();
      if (String(body.sku || "").trim()) updates.item_sku = String(body.sku).trim();
      await shopeeShopApi({ path: "/api/v2/product/update_item", method: "POST", body: updates });
    }

    await supabaseAdmin.from("shopee_product_link").update({
      status: action === "unlist" ? "UNLIST" : action === "relist" ? "NORMAL" : link.status,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", link.id);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyShopeeError(error) || "Falha ao atualizar produto Shopee." }, { status: errorStatus(error) });
  }
}

async function loadRemoteItems() {
  const ids = new Set<number>();
  for (const status of ["NORMAL", "UNLIST", "BANNED"]) {
    let offset = 0;
    for (let page = 0; page < 20; page += 1) {
      const list = await shopeeShopApi<any>({ path: "/api/v2/product/get_item_list", query: { offset, page_size: 100, item_status: status } });
      const rows = list?.response?.item ?? [];
      for (const row of rows) if (Number(row.item_id)) ids.add(Number(row.item_id));
      if (!list?.response?.has_next_page) break;
      const nextOffset = Number(list?.response?.next);
      offset = Number.isFinite(nextOffset) && nextOffset > offset ? nextOffset : offset + Math.max(rows.length, 100);
    }
  }
  const itemIds = Array.from(ids);
  const result: RemoteItem[] = [];
  for (let index = 0; index < itemIds.length; index += 50) {
    const detail = await shopeeShopApi<any>({ path: "/api/v2/product/get_item_base_info", query: { item_id_list: itemIds.slice(index, index + 50).join(","), need_tax_info: false, need_complaint_policy: false } });
    result.push(...(detail?.response?.item_list ?? []));
  }
  return result;
}

async function findRemoteItemCreatedBySku(itemSku: string, title: string) {
  const normalizedSku = itemSku.trim().toLowerCase();
  const normalizedTitle = title.trim().toLowerCase();
  const matches = (await loadRemoteItems()).filter((item) =>
    String(item.item_sku || "").trim().toLowerCase() === normalizedSku
    && String(item.item_name || "").trim().toLowerCase() === normalizedTitle
  );
  return matches.length === 1 ? matches[0] : null;
}

async function reconcileRemoteCatalog(empresaId: number, products: any[], links: any[], items: RemoteItem[]) {
  const productsBySku = new Map<string, any>();
  for (const product of products) {
    const sku = String(product.referencia || "").trim().toLowerCase();
    if (sku) productsBySku.set(sku, product);
  }
  const linksByItem = new Map(links.map((link) => [Number(link.item_id), link]));
  for (const item of items) {
    const existing = linksByItem.get(Number(item.item_id));
    const product = existing ? products.find((row) => Number(row.id) === Number(existing.produto_id)) : productsBySku.get(String(item.item_sku || "").trim().toLowerCase());
    if (!product) continue;
    await supabaseAdmin.from("shopee_product_link").upsert({
      empresa_id: empresaId,
      produto_id: Number(product.id),
      item_id: Number(item.item_id),
      item_sku: item.item_sku || product.referencia || null,
      title: item.item_name || product.titulo,
      status: item.item_status || null,
      raw_item: item,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "empresa_id,produto_id" });
  }
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function positiveNumber(value: unknown) {
  const parsed = parseLocalizedNumber(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function optionalPositiveNumber(value: unknown): number | null {
  const parsed = parseLocalizedNumber(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function optionalNonNegativeInteger(value: unknown): number | null {
  const parsed = parseLocalizedNumber(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseLocalizedNumber(value: unknown) {
  return Number(typeof value === "string" ? value.trim().replace(",", ".") : value);
}

function friendlyShopeeError(error: any) {
  const message = String(error?.message || "");
  if (isAmbiguousShopeeItemCreationError(error)) {
    const requestId = message.match(/request_id\s+([a-z0-9-]+)/i)?.[1];
    return `A Shopee apresentou uma falha interna ao criar o SKU/modelo do anúncio. Os campos obrigatórios da categoria já haviam sido validados pelo ERP. Atualize os anúncios para conferir se ele foi criado e tente novamente somente se não aparecer${requestId ? `. Request ID: ${requestId}` : ""}`;
  }
  return message
    .replace(/^Shopee \/api\/v2\/[^:]+:\s*/i, "")
    .replace(/(?:product\.)?error_permission/gi, "O aplicativo ainda não possui permissão para este recurso")
    .replace(/(?:product\.)?error_param/gi, "A Shopee recusou um ou mais campos do produto")
    .replace("error_item_not_found", "Produto Shopee não encontrado");
}

function isAmbiguousShopeeItemCreationError(error: unknown) {
  const message = String((error as any)?.message || error || "");
  return /BatchGetItemModelCrossShardingUsingMaster|update Item_model table error|mpsku\.add_item_with_basic_info/i.test(message);
}

function publicationStageError(stage: string, cause: unknown) {
  const detail = friendlyShopeeError(cause) || "erro não identificado";
  const error = new Error(`Não foi possível ${stage}: ${detail}`);
  const statusCode = Number((cause as any)?.statusCode);
  if (Number.isInteger(statusCode)) (error as any).statusCode = statusCode;
  return error;
}
