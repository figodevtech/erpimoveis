import "server-only";
import { shopeeShopApi } from "@/lib/integrations/shopee";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function syncShopeeProductInventory(empresaId: number) {
  const { data: links, error } = await supabaseAdmin
    .from("shopee_product_link")
    .select("id, produto_id, item_id, model_id, raw_item")
    .eq("empresa_id", empresaId);
  if (error) throw error;
  const productIds = (links ?? []).map((link: any) => Number(link.produto_id));
  if (!productIds.length) return { checked: 0, updated: 0, failed: 0 };
  const { data: products, error: productError } = await supabaseAdmin
    .from("produto")
    .select("id, precovenda, estoque")
    .in("id", productIds)
    .eq("is_deleted", false);
  if (productError) throw productError;
  const byId = new Map((products ?? []).map((product: any) => [Number(product.id), product]));
  let updated = 0;
  let failed = 0;

  for (const link of links ?? []) {
    const product: any = byId.get(Number((link as any).produto_id));
    if (!product) continue;
    const stock = Math.max(0, Math.trunc(Number(product.estoque || 0)));
    const price = Number(product.precovenda || 0);
    const raw = ((link as any).raw_item && typeof (link as any).raw_item === "object") ? (link as any).raw_item : {};
    const syncState = raw._erp_sync || {};
    const modelId = (link as any).model_id ? Number((link as any).model_id) : undefined;
    const nextRaw = { ...raw, _erp_sync: { ...syncState } };
    try {
      if (syncState.stock !== stock) {
        await shopeeShopApi({ path: "/api/v2/product/update_stock", method: "POST", body: { item_id: Number((link as any).item_id), stock_list: [{ ...(modelId ? { model_id: modelId } : {}), normal_stock: stock }] } });
        nextRaw._erp_sync.stock = stock;
        updated += 1;
      }
      if (price > 0 && syncState.price !== price) {
        await shopeeShopApi({ path: "/api/v2/product/update_price", method: "POST", body: { item_id: Number((link as any).item_id), price_list: [{ ...(modelId ? { model_id: modelId } : {}), original_price: price }] } });
        nextRaw._erp_sync.price = price;
        updated += 1;
      }
      nextRaw._erp_sync.error = null;
      nextRaw._erp_sync.synced_at = new Date().toISOString();
    } catch (syncError: any) {
      failed += 1;
      nextRaw._erp_sync.error = String(syncError?.message || "Falha ao sincronizar produto.");
      nextRaw._erp_sync.synced_at = new Date().toISOString();
    }
    await supabaseAdmin.from("shopee_product_link").update({ raw_item: nextRaw, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", (link as any).id);
  }
  return { checked: links?.length ?? 0, updated, failed };
}
