import { NextRequest, NextResponse } from "next/server";
import { requireEstoqueAccess, requireEstoqueEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { getShopeeCategoryAttributes, shopeeShopApi, uploadShopeeImageFromUrl } from "@/lib/integrations/shopee";
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
        const id = Number(escaped.replace("#", ""));
        productQuery = productQuery.or(`id.eq.${id},titulo.ilike.%${escaped}%,referencia.ilike.%${escaped}%,codigobarras.ilike.%${escaped}%`);
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
    const logisticIds = Array.isArray(body.logisticIds) ? body.logisticIds.map(positiveInteger).filter(Boolean) : [];
    if (!produtoId || !categoryId) return NextResponse.json({ error: "Produto e categoria Shopee são obrigatórios." }, { status: 400 });
    if (!weight) return NextResponse.json({ error: "Informe o peso do pacote em kg." }, { status: 400 });
    if (!logisticIds.length) return NextResponse.json({ error: "Selecione ao menos um canal logístico da Shopee." }, { status: 400 });

    const attributeDefinitions = await getShopeeCategoryAttributes(categoryId);
    const attributeValues = body.attributeValues && typeof body.attributeValues === "object" ? body.attributeValues as Record<string, unknown> : {};
    const requiredMissing = attributeDefinitions
      .filter((attribute: any) => Boolean(attribute?.is_mandatory ?? attribute?.mandatory ?? attribute?.required))
      .filter((attribute: any) => !String(attributeValues[String(attribute?.attribute_id)] ?? "").trim())
      .map((attribute: any) => String(attribute?.original_attribute_name ?? attribute?.display_attribute_name ?? attribute?.attribute_name ?? attribute?.attribute_id));
    if (requiredMissing.length) return NextResponse.json({ error: `Preencha os atributos obrigatórios: ${requiredMissing.join(", ")}.` }, { status: 400 });
    const dynamicAttributeList = buildShopeeAttributes(attributeDefinitions, attributeValues);

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

    const { data: extraImages, error: imagesError } = await supabaseAdmin.from("produto_imagem").select("url").eq("produto_id", produtoId).order("ordem").limit(9);
    if (imagesError) throw publicationStageError("consultar as imagens do produto", imagesError);
    const imageUrls = Array.from(new Set([product.imgUrl, ...(extraImages ?? []).map((row: any) => row.url), ...(Array.isArray(body.imageUrls) ? body.imageUrls : [])].map(String).filter(Boolean))).slice(0, 9);
    if (!imageUrls.length) return NextResponse.json({ error: "Cadastre ao menos uma imagem pública HTTPS no produto." }, { status: 400 });
    const imageIds: string[] = [];
    for (const [index, url] of imageUrls.entries()) {
      try {
        imageIds.push(await uploadShopeeImageFromUrl(url));
      } catch (error) {
        throw publicationStageError(`preparar a imagem ${index + 1}`, error);
      }
    }

    const title = String(body.title || product.tituloMarketplace || product.titulo || "").trim();
    const description = String(body.description || product.descricaoMarketplace || product.descricao || title).trim();
    const price = priceOverride ?? Number(product.precovenda);
    const stock = stockOverride ?? Math.max(0, Math.trunc(Number(product.estoque || 0)));
    if (!title || !description || !Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: "Título, descrição e preço válido são obrigatórios." }, { status: 400 });
    }

    const dimension = {
      package_length: positiveNumber(body.length),
      package_width: positiveNumber(body.width),
      package_height: positiveNumber(body.height),
    };
    if (Object.values(dimension).some((value) => !value)) return NextResponse.json({ error: "Informe comprimento, largura e altura do pacote em cm." }, { status: 400 });

    const payload: Record<string, unknown> = {
      item_name: title,
      description,
      item_sku: String(body.sku || product.referencia || product.id).slice(0, 100),
      category_id: categoryId,
      original_price: price,
      seller_stock: [{ stock }],
      weight,
      dimension,
      condition: String(body.condition || "NEW").toUpperCase(),
      image: { image_id_list: imageIds },
      logistic_info: logisticIds.map((logisticId: number) => ({ logistic_id: logisticId, enabled: true })),
    };
    if (dynamicAttributeList.length) payload.attribute_list = dynamicAttributeList;
    else if (Array.isArray(body.attributeList) && body.attributeList.length) payload.attribute_list = body.attributeList;
    if ((body.brandId !== undefined && body.brandId !== "") || body.brandName || product.fabricante) {
      payload.brand = { brand_id: Number(body.brandId || 0), original_brand_name: String(body.brandName || product.fabricante || "No Brand") };
    }

    let created: any;
    try {
      created = await shopeeShopApi<any>({ path: "/api/v2/product/add_item", method: "POST", body: payload });
    } catch (error) {
      throw publicationStageError("enviar o anúncio para a Shopee", error);
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
    const list = await shopeeShopApi<any>({ path: "/api/v2/product/get_item_list", query: { offset: 0, page_size: 100, item_status: status } });
    for (const row of list?.response?.item ?? []) if (Number(row.item_id)) ids.add(Number(row.item_id));
  }
  const itemIds = Array.from(ids).slice(0, 100);
  const result: RemoteItem[] = [];
  for (let index = 0; index < itemIds.length; index += 50) {
    const detail = await shopeeShopApi<any>({ path: "/api/v2/product/get_item_base_info", query: { item_id_list: itemIds.slice(index, index + 50).join(","), need_tax_info: false, need_complaint_policy: false } });
    result.push(...(detail?.response?.item_list ?? []));
  }
  return result;
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
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function optionalPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function optionalNonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function friendlyShopeeError(error: any) {
  const message = String(error?.message || "");
  return message
    .replace(/^Shopee \/api\/v2\/[^:]+:\s*/i, "")
    .replace("error_permission", "O aplicativo ainda não possui permissão para este recurso")
    .replace("error_param", "A Shopee recusou um ou mais campos do produto")
    .replace("error_item_not_found", "Produto Shopee não encontrado");
}

function publicationStageError(stage: string, cause: unknown) {
  const detail = friendlyShopeeError(cause) || "erro não identificado";
  const error = new Error(`Não foi possível ${stage}: ${detail}`);
  const statusCode = Number((cause as any)?.statusCode);
  if (Number.isInteger(statusCode)) (error as any).statusCode = statusCode;
  return error;
}

function buildShopeeAttributes(definitions: any[], values: Record<string, unknown>) {
  return definitions.flatMap((attribute: any) => {
    const attributeId = Number(attribute?.attribute_id);
    const entered = String(values[String(attributeId)] ?? "").trim();
    if (!attributeId || !entered) return [];
    const options = attribute?.attribute_value_list ?? [];
    const selected = options.find((option: any) => String(option?.value_id) === entered);
    const attributeValue = selected
      ? {
          value_id: Number(selected.value_id),
          original_value_name: selected.original_value_name || selected.display_value_name || selected.value_name || selected.name,
          ...(selected.value_unit ? { value_unit: selected.value_unit } : {}),
        }
      : (() => {
          const defaultUnit = (attribute?.attribute_unit ?? attribute?.unit_list ?? []).map((unit: any) => String(unit?.value_unit ?? unit?.unit ?? unit ?? "").trim()).find(Boolean);
          const unit = String(values[`${attributeId}__unit`] ?? defaultUnit ?? "").trim();
          return { original_value_name: entered, ...(unit ? { value_unit: unit } : {}) };
        })();
    return [{ attribute_id: attributeId, attribute_value_list: [attributeValue] }];
  });
}
