import { NextResponse } from "next/server";
import { requireEstoqueEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await requireEstoqueEdit();
    const empresaId = await requireEmpresaId();
    const [products, imageProductIds] = await Promise.all([
      loadProducts(),
      loadImageProductIds(),
    ]);
    const eligibleIds = products
      .filter((product) => Boolean(product.imgUrl?.trim()) || imageProductIds.has(Number(product.id)))
      .map((product) => Number(product.id));
    const eligibleSet = new Set(eligibleIds);
    const withoutImageIds = products
      .map((product) => Number(product.id))
      .filter((productId) => !eligibleSet.has(productId));
    const now = new Date().toISOString();

    for (let index = 0; index < eligibleIds.length; index += 500) {
      const { error } = await supabaseAdmin.from("site_product_link").upsert(
        eligibleIds.slice(index, index + 500).map((productId) => ({
          empresa_id: empresaId,
          produto_id: productId,
          status: "PUBLICADO",
          updated_at: now,
        })),
        { onConflict: "empresa_id,produto_id" },
      );
      if (error) throw error;
    }
    for (let index = 0; index < withoutImageIds.length; index += 500) {
      const { error } = await supabaseAdmin.from("site_product_link").upsert(
        withoutImageIds.slice(index, index + 500).map((productId) => ({
          empresa_id: empresaId,
          produto_id: productId,
          status: "PAUSADO",
          updated_at: now,
        })),
        { onConflict: "empresa_id,produto_id" },
      );
      if (error) throw error;
    }

    return NextResponse.json({
      ok: true,
      published: eligibleIds.length,
      skippedWithoutImage: withoutImageIds.length,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Falha ao publicar o catálogo.",
      },
      { status: errorStatus(error) },
    );
  }
}

async function loadProducts() {
  const rows: Array<{ id: number; imgUrl: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("produto")
      .select("id,imgUrl")
      .eq("is_deleted", false)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

async function loadImageProductIds() {
  const ids = new Set<number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("produto_imagem")
      .select("produto_id")
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    for (const row of data ?? []) ids.add(Number(row.produto_id));
    if ((data ?? []).length < 1000) return ids;
  }
}
