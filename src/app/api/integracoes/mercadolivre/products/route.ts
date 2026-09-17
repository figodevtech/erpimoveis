import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { productImageUrlsForListing } from "@/lib/integrations/mercadolivre-listing-pictures";
import { getProductSearchTokens } from "@/lib/product-search";
import { syncMercadoLivreProductLinks } from "@/lib/integrations/mercadolivre-reconciliation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const search = req.nextUrl.searchParams.get("search")?.trim() ?? "";
    const requestedProductId = req.nextUrl.searchParams.get("productId");
    const includeOutOfStock = req.nextUrl.searchParams.get("includeOutOfStock") === "1";
    const productId = requestedProductId ? Number(requestedProductId) : null;
    if (requestedProductId && (!Number.isInteger(productId) || Number(productId) <= 0)) {
      return NextResponse.json({ error: "productId invalido." }, { status: 400 });
    }
    // A aba de anúncios precisa de todos os produtos vinculados, não dos que
    // estão na página atual da lista de produtos — e sem o corte por estoque,
    // senão o anúncio de um produto zerado some da tela.
    const onlyLinked = req.nextUrl.searchParams.get("linked") === "1";
    const onlyUnlinked = req.nextUrl.searchParams.get("unlinked") === "1";
    const page = Math.max(Number(req.nextUrl.searchParams.get("page") ?? 1), 1);
    const fullList = onlyLinked || onlyUnlinked;
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? (fullList ? 500 : 20)), 1), fullList ? 1000 : 100);

    const tokens = getProductSearchTokens(search);
    if (search.length > 300 || tokens.length > 20 || !Number.isSafeInteger(page) || page > 100000 || !Number.isSafeInteger(limit)) {
      return NextResponse.json({ error: "Parâmetros de busca inválidos." }, { status: 400 });
    }
    const { data: result, error: searchError } = await supabaseAdmin.rpc("marketplace_search_products", {
      p_empresa_id: empresaId, p_tokens: tokens, p_page: page, p_limit: limit,
      p_product_id: productId, p_linked: onlyLinked, p_unlinked: onlyUnlinked,
      p_include_zero: includeOutOfStock,
    });
    if (searchError) throw searchError;
    const products = (result?.data ?? []) as any[];
    const totalCount = Number(result?.total ?? 0);

    const productIds = (products ?? []).map((item) => Number(item.id)).filter(Number.isFinite);
    const { data: links, error: linksError } = productIds.length
      ? await supabaseAdmin
          .from("mercadolivre_product_link")
          .select("id, empresa_id, produto_id, ml_item_id, ml_variation_id, title, permalink, status, user_product_id, family_id, family_name, domain_id, catalog_product_id, user_product_enabled, item_tags, visits_total, sold_quantity, available_quantity, listing_type_id, item_condition, health, catalog_listing, stop_time, metrics_updated_at, updated_at, price_state:raw_item->_erp_price_state, quality:raw_item->_erp_quality")
          .eq("empresa_id", empresaId)
          .in("produto_id", productIds)
      : { data: [], error: null };

    if (linksError) throw linksError;
    const syncedLinks = await syncMercadoLivreProductLinks(links ?? []);

    const { data: images, error: imagesError } = productIds.length
      ? await supabaseAdmin
          .from("produto_imagem")
          .select("produto_id, url, ordem")
          .in("produto_id", productIds)
          .order("ordem", { ascending: true })
          .order("id", { ascending: true })
      : { data: [], error: null };

    if (imagesError) throw imagesError;

    const linkByProduct = new Map(syncedLinks.map((link: any) => [Number(link.produto_id), link]));
    const imagesByProduct = new Map<number, string[]>();
    for (const image of images ?? []) {
      const produtoId = Number((image as any).produto_id);
      const url = String((image as any).url ?? "").trim();
      if (!produtoId || !url) continue;
      const current = imagesByProduct.get(produtoId) ?? [];
      current.push(url);
      imagesByProduct.set(produtoId, current);
    }

    const items = (products ?? []).map((product: any) => ({
      ...product,
      imageUrls: productImageUrlsForListing(product.imgUrl, imagesByProduct.get(Number(product.id)) ?? []),
      mercadolivre: linkByProduct.get(Number(product.id)) ?? null,
    }));

    return NextResponse.json({
      data: items,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      },
    });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/products", e);
    return NextResponse.json({ error: e?.message || "Falha ao carregar produtos marketplace." }, { status: errorStatus(e) });
  }
}
