import { NextRequest, NextResponse } from "next/server";
import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { idDeBusca } from "@/lib/busca-numerica";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireEstoqueAccess();
    const empresaId = await requireEmpresaId();
    const search = request.nextUrl.searchParams.get("search")?.trim() || "";
    const channelStatus = request.nextUrl.searchParams.get("status") || "all";
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const limit = Math.min(100, Math.max(20, Number(request.nextUrl.searchParams.get("limit") || 20)));
    const shopeeEnabled = process.env.NEXT_PUBLIC_SHOPEE_INTEGRATION_ENABLED === "true";

    const [
      { data: mlLinks, error: mlError },
      { data: siteLinks, error: siteError },
      { data: shopeeLinks, error: shopeeError },
    ] = await Promise.all([
      supabaseAdmin.from("mercadolivre_product_link").select("id, produto_id, ml_item_id, title, status, permalink, updated_at").eq("empresa_id", empresaId),
      supabaseAdmin.from("site_product_link").select("id, produto_id, status, sync_status, slug, updated_at").eq("empresa_id", empresaId),
      shopeeEnabled
        ? supabaseAdmin.from("shopee_product_link").select("id, produto_id, item_id, model_id, item_sku, title, status, updated_at").eq("empresa_id", empresaId)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (mlError) throw mlError;
    if (siteError) throw siteError;
    if (shopeeError) throw shopeeError;

    const mlByProduct = new Map((mlLinks ?? []).map((link: any) => [Number(link.produto_id), link]));
    const siteByProduct = new Map((siteLinks ?? []).map((link: any) => [Number(link.produto_id), link]));
    const shopeeByProduct = new Map((shopeeLinks ?? []).map((link: any) => [Number(link.produto_id), link]));
    const mlIds = new Set(mlByProduct.keys());
    const siteIds = new Set(siteByProduct.keys());
    const shopeeIds = new Set(shopeeByProduct.keys());
    const activeChannelIds = [siteIds, mlIds, ...(shopeeEnabled ? [shopeeIds] : [])];
    const filterIds = marketplaceFilterIds(channelStatus, siteIds, mlIds, shopeeIds, activeChannelIds);

    if (filterIds && !filterIds.length) {
      return NextResponse.json({ data: [], pagination: { page: 1, limit, total: 0, totalPages: 1 }, summary: marketplaceSummary(siteIds, mlIds, shopeeIds, activeChannelIds) });
    }

    let query = supabaseAdmin
      .from("produto")
      .select("id, titulo, referencia, precovenda, estoque, status_estoque, imgUrl, fabricante, codigobarras", { count: "exact" })
      .eq("is_deleted", false)
      .order("id", { ascending: false });

    if (search) {
      const term = search.replace(/[,%()]/g, " ").trim();
      if (/^#?\d+$/.test(term)) {
        const id = idDeBusca(term);
        query = query.or(`${id !== null ? `id.eq.${id},` : ""}titulo.ilike.%${term}%,referencia.ilike.%${term}%,codigobarras.ilike.%${term}%`);
      } else {
        query = query.or(`titulo.ilike.%${term}%,referencia.ilike.%${term}%,fabricante.ilike.%${term}%,codigobarras.ilike.%${term}%`);
      }
    }
    if (filterIds) query = query.in("id", filterIds);
    if (channelStatus === "unlinked") {
      const linkedIds = Array.from(new Set(activeChannelIds.flatMap((ids) => Array.from(ids))));
      if (linkedIds.length) query = query.not("id", "in", `(${linkedIds.join(",")})`);
    }

    const from = (page - 1) * limit;
    const { data: products, error: productError, count } = await query.range(from, from + limit - 1);
    if (productError) throw productError;

    const productIds = (products ?? []).map((product: any) => Number(product.id));
    const { data: images, error: imageError } = productIds.length
      ? await supabaseAdmin.from("produto_imagem").select("produto_id, url, ordem").in("produto_id", productIds).order("ordem")
      : { data: [], error: null };
    if (imageError) throw imageError;
    const firstImageByProduct = new Map<number, string>();
    for (const image of images ?? []) {
      const productId = Number((image as any).produto_id);
      if (!firstImageByProduct.has(productId) && (image as any).url) firstImageByProduct.set(productId, String((image as any).url));
    }

    return NextResponse.json({
      data: (products ?? []).map((product: any) => ({
        ...product,
        imageUrl: product.imgUrl || firstImageByProduct.get(Number(product.id)) || null,
        site: siteByProduct.get(Number(product.id)) ?? null,
        mercadolivre: mlByProduct.get(Number(product.id)) ?? null,
        shopee: shopeeEnabled ? shopeeByProduct.get(Number(product.id)) ?? null : null,
      })),
      pagination: { page, limit, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / limit)) },
      summary: marketplaceSummary(siteIds, mlIds, shopeeIds, activeChannelIds),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Falha ao carregar catálogo multicanal." }, { status: errorStatus(error) });
  }
}

function marketplaceFilterIds(
  status: string,
  siteIds: Set<number>,
  mlIds: Set<number>,
  shopeeIds: Set<number>,
  activeChannelIds: Set<number>[],
) {
  if (status === "site") return Array.from(siteIds);
  if (status === "mercadolivre") return Array.from(mlIds);
  if (status === "shopee") return Array.from(shopeeIds);
  if (status === "both" || status === "all_channels") {
    const [first, ...remaining] = activeChannelIds;
    return first ? Array.from(first).filter((id) => remaining.every((ids) => ids.has(id))) : [];
  }
  if (status === "incomplete") {
    const linkedIds = new Set(activeChannelIds.flatMap((ids) => Array.from(ids)));
    return Array.from(linkedIds).filter((id) => !activeChannelIds.every((ids) => ids.has(id)));
  }
  if (status === "single") {
    const linkedIds = new Set(activeChannelIds.flatMap((ids) => Array.from(ids)));
    return Array.from(linkedIds).filter((id) => activeChannelIds.filter((ids) => ids.has(id)).length === 1);
  }
  return null;
}

function marketplaceSummary(
  siteIds: Set<number>,
  mlIds: Set<number>,
  shopeeIds: Set<number>,
  activeChannelIds: Set<number>[],
) {
  const [first, ...remaining] = activeChannelIds;
  const allChannels = first ? Array.from(first).filter((id) => remaining.every((ids) => ids.has(id))).length : 0;
  const linked = new Set(activeChannelIds.flatMap((ids) => Array.from(ids))).size;
  return { site: siteIds.size, mercadolivre: mlIds.size, shopee: shopeeIds.size, allChannels, both: allChannels, linked };
}
