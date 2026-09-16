import { buildStockOnlyPayload } from "./mercadolivre-stock-payload";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { assertMercadoLivreItemStockWritable } from "./mercadolivre-stock-policy";
import { mercadoLivreApiGet, mercadoLivreApiPut } from "@/lib/integrations/mercadolivre";
import { registerMercadoLivreOutboundTouch } from "@/lib/integrations/mercadolivre-outbound-touch";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ReservedStockSync = {
  queue_id: number;
  empresa_id: number;
  product_link_id: number;
  produto_id: number;
  desired_quantity: number;
  attempts: number;
};

export async function syncPendingMercadoLivreStock(params?: { productIds?: number[]; limit?: number }) {
  const productIds = Array.from(new Set((params?.productIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0)));
  const { data, error } = await supabaseAdmin.rpc("fn_reservar_sincronizacao_estoque_ml", {
    p_limit: Math.min(Math.max(params?.limit ?? 30, 1), 100),
    p_product_ids: productIds.length ? productIds : null,
  });
  if (error) throw error;

  const reserved = (data ?? []) as ReservedStockSync[];
  const results = [];
  for (const job of reserved) results.push(await processStockSync(job));
  return results;
}

export async function enqueueMercadoLivreProductSync(productId: number) {
  if (!Number.isInteger(productId) || productId <= 0) return 0;

  const [{ data: product, error: productError }, { data: links, error: linksError }] = await Promise.all([
    supabaseAdmin.from("produto").select("id, estoque").eq("id", productId).maybeSingle(),
    supabaseAdmin
      .from("mercadolivre_product_link")
      .select("id, empresa_id")
      .eq("produto_id", productId),
  ]);
  if (productError) throw productError;
  if (linksError) throw linksError;
  if (!product || !links?.length) return 0;

  const { error } = await supabaseAdmin
    .from("mercadolivre_stock_sync_queue")
    .upsert(
      links.map((link) => ({
        empresa_id: Number(link.empresa_id),
        product_link_id: Number(link.id),
        produto_id: productId,
        desired_quantity: Math.max(Math.trunc(Number(product.estoque) || 0), 0),
        status: "PENDENTE",
        attempts: 0,
        next_retry_at: null,
        locked_at: null,
        last_error: null,
        processed_at: null,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "product_link_id" },
    );
  if (error) throw error;
  return links.length;
}

async function processStockSync(job: ReservedStockSync) {
  try {
    const { data: link, error: linkError } = await supabaseAdmin
      .from("mercadolivre_product_link")
      .select("id, empresa_id, produto_id, ml_item_id, ml_variation_id, status, raw_item")
      .eq("id", job.product_link_id).eq("empresa_id", job.empresa_id).single();
    if (linkError) throw linkError;

    if (["closed", "deleted"].includes(String(link.status ?? "").toLowerCase())) {
      await completeJob(job, "IGNORADA", null);
      return { produtoId: job.produto_id, itemId: link.ml_item_id, ok: true, skipped: "Anúncio encerrado." };
    }

    const account = await getValidMercadoLivreAccount(job.empresa_id);
    const quantity = Math.max(Math.trunc(Number(job.desired_quantity) || 0), 0);
    const itemBefore = await mercadoLivreApiGet<any>(
      account.access_token,
      `/items/${encodeURIComponent(String(link.ml_item_id))}`,
    );
    assertMercadoLivreItemStockWritable(itemBefore);
    const quantityBefore = getConfirmedQuantity(itemBefore, link.ml_variation_id);
    const payload = buildStockOnlyPayload(quantity, link.ml_variation_id);

    await mercadoLivreApiPut<any>(account.access_token, `/items/${encodeURIComponent(String(link.ml_item_id))}`, payload);
    // O Mercado Livre devolve um webhook `items` por causa deste PUT. Marcamos a
    // autoria para que ele não vire aviso de "anúncio atualizado" para o usuário.
    await registerMercadoLivreOutboundTouch({
      empresaId: job.empresa_id,
      itemId: String(link.ml_item_id),
      kinds: ["ESTOQUE"],
      origin: "syncPendingMercadoLivreStock",
    });
    let item = await mercadoLivreApiGet<any>(account.access_token, `/items/${encodeURIComponent(String(link.ml_item_id))}`);
    let confirmedQuantity = getConfirmedQuantity(item, link.ml_variation_id);
    // Propagação assíncrona: repetir apenas a leitura, nunca o PUT nesta confirmação.
    for (const delay of [500, 1000]) {
      if (confirmedQuantity === quantity) break;
      await new Promise(resolve => setTimeout(resolve, delay));
      item = await mercadoLivreApiGet<any>(account.access_token, `/items/${encodeURIComponent(String(link.ml_item_id))}`);
      confirmedQuantity = getConfirmedQuantity(item, link.ml_variation_id);
    }
    if (confirmedQuantity !== quantity) {
      throw new Error(
        `O Mercado Livre não confirmou o estoque solicitado. ERP: ${quantity}; Mercado Livre: ${confirmedQuantity}. ` +
          "Verifique se o anúncio utiliza estoque Full ou multiorigem.",
      );
    }

    const { error: updateLinkError } = await supabaseAdmin
      .from("mercadolivre_product_link")
      .update({
        status: item?.status ?? link.status,
        available_quantity: quantity,
        raw_item: {
          ...(item ?? {}),
          _erp_stock_sync: {
            previousQuantity: quantityBefore,
            currentQuantity: quantity,
            delta: quantity - quantityBefore,
            synchronizedAt: new Date().toISOString(),
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", link.id);
    if (updateLinkError) throw updateLinkError;
    await completeJob(job, "PROCESSADA", null);
    return {
      produtoId: job.produto_id, itemId: link.ml_item_id, quantity,
      priceSkipped: true, message: "Estoque atualizado. O preço do anúncio foi preservado.", ok: true,
    };
  } catch (error: any) {
    const message = String(error?.message ?? "Falha ao sincronizar estoque com o Mercado Livre.");
    await failJob(job, message);
    return { produtoId: job.produto_id, ok: false, error: message };
  }
}

async function completeJob(job: ReservedStockSync, status: string, error: string | null) {
  const { error: updateError } = await supabaseAdmin
    .from("mercadolivre_stock_sync_queue")
    .update({
      status,
      locked_at: null,
      next_retry_at: null,
      last_error: error,
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.queue_id)
    .eq("status", "PROCESSANDO")
    .eq("desired_quantity", job.desired_quantity);
  if (updateError) throw updateError;
}

async function failJob(job: ReservedStockSync, message: string) {
  const delayMinutes = Math.min(5 * 2 ** Math.max(job.attempts - 1, 0), 360);
  const { error: updateError } = await supabaseAdmin
    .from("mercadolivre_stock_sync_queue")
    .update({
      status: "ERRO",
      locked_at: null,
      last_error: message.slice(0, 2000),
      next_retry_at: new Date(Date.now() + delayMinutes * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.queue_id)
    .eq("status", "PROCESSANDO")
    .eq("desired_quantity", job.desired_quantity);
  if (updateError) console.error("Falha ao registrar erro da sincronização de estoque do Mercado Livre:", updateError);
}

function getConfirmedQuantity(item: any, variationId: unknown) {
  if (!variationId) return Math.max(Math.trunc(Number(item?.available_quantity) || 0), 0);

  const variation = (Array.isArray(item?.variations) ? item.variations : []).find(
    (candidate: any) => String(candidate?.id) === String(variationId),
  );
  if (!variation) throw new Error("A variação vinculada ao produto não foi encontrada no anúncio do Mercado Livre.");
  return Math.max(Math.trunc(Number(variation.available_quantity) || 0), 0);
}
