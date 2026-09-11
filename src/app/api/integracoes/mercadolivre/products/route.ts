import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
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

    let query = supabaseAdmin
      .from("produto")
      .select(
        "id, titulo, descricao, referencia, precovenda, estoque, status_estoque, tituloMarketplace, descricaoMarketplace, imgUrl, fabricante, codigobarras, conservacao",
        { count: "exact" },
      )
      .eq("is_deleted", false)
      .order("id", { ascending: false })
      .range(from, to);

    if (search) {
      const term = search.replace(/[,%()]/g, " ").trim();
      if (/^#?\d+$/.test(term)) {
        const id = Number(term.replace("#", ""));
        query = query.or(`id.eq.${id},titulo.ilike.%${term}%,referencia.ilike.%${term}%,codigobarras.ilike.%${term}%`);
      } else {
        query = query.or(`titulo.ilike.%${term}%,referencia.ilike.%${term}%,tituloMarketplace.ilike.%${term}%,fabricante.ilike.%${term}%,codigobarras.ilike.%${term}%`);
      }
    }
    if (productId) query = query.eq("id", productId);
    else if (linkedProductIds) {
      // `unlinked=1` é o espelho de `linked=1`: os seletores de vínculo
      // precisam de todo o catálogo publicável, não da página atual.
      if (onlyUnlinked) {
        if (linkedProductIds.length) query = query.not("id", "in", `(${linkedProductIds.join(",")})`);
      } else {
        query = query.in("id", linkedProductIds.length ? linkedProductIds : [-1]);
      }
    }
    else if (!includeOutOfStock) query = query.gt("estoque", 0);

    const { data: products, error, count } = await query;
    if (error) throw error;

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
        total: count ?? 0,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / limit)),
      },
    });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/products", e);
    return NextResponse.json({ error: e?.message || "Falha ao carregar produtos marketplace." }, { status: errorStatus(e) });
  }
}
