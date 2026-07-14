import { NextResponse } from "next/server";
import { requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const account = await getDefaultAccount(empresaId);
    const item = await mercadoLivreApiGet<any>(account.access_token, `/items/${encodeURIComponent(mlItemId)}`);
    const userProduct = item?.user_product_id
      ? await mercadoLivreApiGet<any>(account.access_token, `/user-products/${encodeURIComponent(String(item.user_product_id))}`).catch(() => null)
      : null;

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

async function getDefaultAccount(empresaId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, access_token")
    .eq("empresa_id", empresaId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (error) throw error;
  return data as { id: number; empresa_id: number; access_token: string };
}
