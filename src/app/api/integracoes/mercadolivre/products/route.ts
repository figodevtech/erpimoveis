import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { getProductSearchTokens, matchesProductSearch } from "@/lib/product-search";
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
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let linkedProductIds: number[] | null = null;
    if (onlyLinked || onlyUnlinked) {
      const { data: linkedRows, error: linkedError } = await supabaseAdmin
        .from("mercadolivre_product_link")
        .select("produto_id")
        .eq("empresa_id", empresaId)
        .not("ml_item_id", "is", null);
      if (linkedError) throw linkedError;
      linkedProductIds = Array.from(
        new Set((linkedRows ?? []).map((row) => Number(row.produto_id)).filter((id) => Number.isInteger(id) && id > 0)),
      );
    }

    const PRODUTO_SELECT =
      "id, titulo, descricao, referencia, precovenda, estoque, status_estoque, tituloMarketplace, descricaoMarketplace, imgUrl, fabricante, codigobarras, conservacao, etiqueta, local, ncm, cest";

    let products: any[] = [];
    let totalCount = 0;

    const searchTokens = search ? getProductSearchTokens(search) : [];
    const cleanSearch = search.replace(/^#/, "").trim();
    const isNumericSearch = /^\d+$/.test(cleanSearch);
    const isAlphaNumericCodeSearch = /[a-z]/i.test(cleanSearch) && /\d/.test(cleanSearch) && /^[a-z0-9]+$/i.test(cleanSearch);
    const isSingleStructuredSearch = searchTokens.length === 1 && searchTokens[0]?.structured;
    const safeDirectSearch = cleanSearch.replace(/[,%()]/g, " ").trim();

    const canUseDirectQuery = !search || Boolean(safeDirectSearch && (isNumericSearch || isAlphaNumericCodeSearch || isSingleStructuredSearch));

    if (canUseDirectQuery) {
      let query = supabaseAdmin
        .from("produto")
        .select(PRODUTO_SELECT, { count: "exact" })
        .eq("is_deleted", false)
        .order("id", { ascending: false });

      if (safeDirectSearch) {
        const structuredColumns = ["referencia", "codigobarras", "etiqueta", "ncm", "cest"];
        const generalColumns = [
          ...structuredColumns,
          "titulo",
          "descricao",
          "fabricante",
          "local",
          "tituloMarketplace",
          "descricaoMarketplace",
        ];
        const directFilters = (isNumericSearch || isAlphaNumericCodeSearch ? generalColumns : structuredColumns).map(
          (column) => `${column}.ilike.%${safeDirectSearch}%`,
        );

        const numericId = Number(safeDirectSearch);
        if (isNumericSearch && Number.isInteger(numericId) && numericId > 0 && numericId <= 2_147_483_647) {
          directFilters.push(`id.eq.${numericId}`);
        }
        query = query.or(directFilters.join(","));
      }

      if (productId) query = query.eq("id", productId);
      else if (linkedProductIds) {
        if (onlyUnlinked) {
          if (linkedProductIds.length) query = query.not("id", "in", `(${linkedProductIds.join(",")})`);
        } else {
          query = query.in("id", linkedProductIds.length ? linkedProductIds : [-1]);
        }
      } else if (!includeOutOfStock) query = query.gt("estoque", 0);

      query = query.range(from, to);
      const { data, error, count } = await query;
      if (error) throw error;
      products = data ?? [];
      totalCount = count ?? 0;
    } else {
      const batchSize = 1000;
      const searchableProducts: any[] = [];

      for (let batchFrom = 0; ; batchFrom += batchSize) {
        let searchQuery = supabaseAdmin
          .from("produto")
          .select(PRODUTO_SELECT)
          .eq("is_deleted", false)
          .order("id", { ascending: false })
          .range(batchFrom, batchFrom + batchSize - 1);

        if (productId) searchQuery = searchQuery.eq("id", productId);
        else if (linkedProductIds) {
          if (onlyUnlinked) {
            if (linkedProductIds.length) searchQuery = searchQuery.not("id", "in", `(${linkedProductIds.join(",")})`);
          } else {
            searchQuery = searchQuery.in("id", linkedProductIds.length ? linkedProductIds : [-1]);
          }
        } else if (!includeOutOfStock) searchQuery = searchQuery.gt("estoque", 0);

        const { data, error } = await searchQuery;
        if (error) throw error;
        if (!data?.length) break;
        searchableProducts.push(...data);
        if (data.length < batchSize) break;
      }

      const filtered = searchableProducts.filter((product) =>
        matchesProductSearch(product, searchTokens),
      );
      totalCount = filtered.length;
      products = filtered.slice(from, from + limit);
    }

    const productIds = (products ?? []).map((item) => Number(item.id)).filter(Number.isFinite);
    const { data: links, error: linksError } = productIds.length
      ? await supabaseAdmin
          .from("mercadolivre_product_link")
          .select("id, empresa_id, produto_id, ml_item_id, ml_variation_id, title, permalink, status, user_product_id, family_id, family_name, domain_id, catalog_product_id, user_product_enabled, item_tags, visits_total, sold_quantity, available_quantity, listing_type_id, item_condition, health, catalog_listing, stop_time, metrics_updated_at, updated_at")
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
      imageUrls: Array.from(new Set([product.imgUrl, ...(imagesByProduct.get(Number(product.id)) ?? [])].filter(Boolean))),
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
