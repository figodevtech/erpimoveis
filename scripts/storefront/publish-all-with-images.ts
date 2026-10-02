import { createClient } from "@supabase/supabase-js";
import { syncStorefrontCatalog } from "../../src/lib/integrations/storefront-catalog";

async function main() {
  const empresaId = Number(process.argv[2] || 1);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) throw new Error("Credenciais Supabase do ERP ausentes.");
  if (!Number.isInteger(empresaId) || empresaId <= 0) throw new Error("empresa_id inválido.");

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const products: Array<{ id: number; imgUrl: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("produto")
      .select("id,imgUrl")
      .eq("is_deleted", false)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    products.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  const imageProductIds = new Set<number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("produto_imagem")
      .select("produto_id")
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    for (const row of data ?? []) imageProductIds.add(Number(row.produto_id));
    if ((data ?? []).length < 1000) break;
  }

  const eligibleIds = products
    .filter((product) => Boolean(product.imgUrl?.trim()) || imageProductIds.has(Number(product.id)))
    .map((product) => Number(product.id));
  const eligibleSet = new Set(eligibleIds);
  const withoutImageIds = products
    .map((product) => Number(product.id))
    .filter((productId) => !eligibleSet.has(productId));
  const now = new Date().toISOString();
  for (let index = 0; index < eligibleIds.length; index += 500) {
    const { error } = await db.from("site_product_link").upsert(
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
    const { error } = await db.from("site_product_link").upsert(
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

  let synced = 0;
  for (let batch = 0; batch < 25; batch += 1) {
    const result = await syncStorefrontCatalog(empresaId);
    synced += result.products;
    if (result.processed === 0) break;
  }

  console.log(JSON.stringify({
    erpProducts: products.length,
    publishedWithImage: eligibleIds.length,
    skippedWithoutImage: withoutImageIds.length,
    synced,
  }));
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.stack || error.message
      : JSON.stringify(error, null, 2),
  );
  process.exitCode = 1;
});
