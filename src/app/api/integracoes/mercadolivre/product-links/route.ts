import { NextResponse } from "next/server";
import { requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { extractMercadoLivrePackageSnapshot } from "@/lib/integrations/mercadolivre-package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireVendasEdit();
    const empresaId = await requireEmpresaId();
    const account = await getValidMercadoLivreAccount(empresaId);
    // A busca devolve no máximo 100 ids por chamada. Sem paginar, uma conta com
    // mais de 100 anúncios em qualquer status perdia o excedente silenciosamente.
    // Em revisão e inativo entram para o anúncio moderado não sumir da aba.
    const itemIds = Array.from(
      new Set(
        (await Promise.all(SEARCH_STATUSES.map((status) => searchAllItems(account, status)))).flat(),
      ),
    );

    const { data: links, error: linksError } = await supabaseAdmin
      .from("mercadolivre_product_link")
      .select("ml_item_id, produto_id")
      .eq("empresa_id", empresaId)
      .in("ml_item_id", itemIds.length ? itemIds : ["__nenhum__"]);
    if (linksError) throw linksError;

    const linkedByItem = new Map(
      (links ?? []).map((link) => [String(link.ml_item_id), Number(link.produto_id)]),
    );
    const items: any[] = [];

    for (let index = 0; index < itemIds.length; index += 20) {
      const ids = itemIds.slice(index, index + 20);
      const batch = await mercadoLivreApiGet<any[]>(
        account.access_token,
        `/items?ids=${encodeURIComponent(ids.join(","))}`,
      );
      for (const response of batch ?? []) {
        const item = response?.body ?? response;
        if (!item?.id) continue;
        items.push({
          id: String(item.id),
          title: item.title ?? "Anúncio sem título",
          status: item.status ?? null,
          price: Number(item.price ?? 0),
          soldQuantity: Number(item.sold_quantity ?? 0),
          availableQuantity: Number(item.available_quantity ?? 0),
          thumbnail: item.thumbnail ?? null,
          permalink: item.permalink ?? null,
          produtoId: linkedByItem.get(String(item.id)) ?? null,
        });
      }
    }

    return NextResponse.json({ data: items, total: itemIds.length });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/product-links", e);
    return NextResponse.json(
      { error: e?.message || "Falha ao buscar anúncios publicados." },
      { status: errorStatus(e) },
    );
  }
}

export async function POST(req: Request) {
  try {
    await requireVendasEdit();
    const empresaId = await requireEmpresaId();
    const body = await req.json().catch(() => ({}));
    const produtoId = Number(body?.produtoId);
    const mlItemId = String(body?.mlItemId ?? "").trim().toUpperCase();
    const mlVariationId = body?.mlVariationId ? Number(body.mlVariationId) : null;

    if (!Number.isInteger(produtoId) || produtoId <= 0) {
      return NextResponse.json({ error: "produtoId invalido." }, { status: 400 });
    }
    if (!mlItemId) {
      return NextResponse.json({ error: "Informe o codigo do anuncio Mercado Livre." }, { status: 400 });
    }

    const account = await getValidMercadoLivreAccount(empresaId);
    const item = await mercadoLivreApiGet<any>(account.access_token, `/items/${encodeURIComponent(mlItemId)}`);
    const userProduct = item?.user_product_id
      ? await mercadoLivreApiGet<any>(account.access_token, `/user-products/${encodeURIComponent(String(item.user_product_id))}`).catch(() => null)
      : null;
    const packageSnapshot = extractMercadoLivrePackageSnapshot(item);

    const { data, error } = await supabaseAdmin
      .from("mercadolivre_product_link")
      .upsert(
        {
          empresa_id: account.empresa_id,
          produto_id: produtoId,
          ml_item_id: mlItemId,
          ml_variation_id: mlVariationId,
          title: item?.title ?? null,
          permalink: item?.permalink ?? null,
          status: item?.status ?? null,
          user_product_id: item?.user_product_id ?? null,
          family_id: userProduct?.family_id ?? item?.family_id ?? null,
          family_name: item?.family_name ?? userProduct?.family_name ?? null,
          domain_id: item?.domain_id ?? userProduct?.domain_id ?? null,
          catalog_product_id: item?.catalog_product_id ?? userProduct?.catalog_product_id ?? null,
          user_product_enabled: Boolean(item?.family_name || item?.user_product_id),
          item_tags: Array.isArray(item?.tags) ? item.tags : [],
          ...packageSnapshot,
          raw_item: item ?? {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: "empresa_id,produto_id" },
      )
      .select("id, empresa_id, produto_id, ml_item_id, ml_variation_id, title, permalink, status, updated_at")
      .single();

    if (error) throw error;
    return NextResponse.json({ data });
  } catch (e: any) {
    console.error("POST /api/integracoes/mercadolivre/product-links", e);
    return NextResponse.json({ error: e?.message || "Falha ao vincular anúncio." }, { status: errorStatus(e) });
  }
}

export async function DELETE(req: Request) {
  try {
    await requireVendasEdit();
    const empresaId = await requireEmpresaId();
    const { searchParams } = new URL(req.url);
    const produtoId = Number(searchParams.get("produtoId"));

    if (!Number.isInteger(produtoId) || produtoId <= 0) {
      return NextResponse.json({ error: "produtoId invalido." }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("mercadolivre_product_link")
      .delete()
      .eq("empresa_id", empresaId)
      .eq("produto_id", produtoId);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("DELETE /api/integracoes/mercadolivre/product-links", e);
    return NextResponse.json({ error: e?.message || "Falha ao remover vínculo." }, { status: errorStatus(e) });
  }
}

const SEARCH_STATUSES = ["active", "paused", "closed", "under_review", "inactive"];
const SEARCH_PAGE_SIZE = 100;
/** O `offset` da busca de itens é limitado a 1000 pelo Mercado Livre. */
const SEARCH_MAX_OFFSET = 1000;

/**
 * Falha na busca sobe como erro. Engolida, ela virava lista vazia com cara de
 * sucesso — com token vencido, os anúncios sem vínculo sumiam da aba sem aviso.
 */
async function searchAllItems(account: { access_token: string; ml_user_id: number | string }, status: string) {
  const ids: string[] = [];
  for (let offset = 0; offset <= SEARCH_MAX_OFFSET; offset += SEARCH_PAGE_SIZE) {
    const page = await mercadoLivreApiGet<any>(
      account.access_token,
      `/users/${account.ml_user_id}/items/search?status=${encodeURIComponent(status)}&limit=${SEARCH_PAGE_SIZE}&offset=${offset}`,
    );
    const results = Array.isArray(page?.results) ? page.results.map(String).filter(Boolean) : [];
    ids.push(...results);
    if (results.length < SEARCH_PAGE_SIZE) break;
  }
  return ids;
}
