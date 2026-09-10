import { isMercadoLivreNotFound, mercadoLivreApiGet, mercadoLivreTokenMetadata, refreshMercadoLivreToken, tokenExpiresAt } from "@/lib/integrations/mercadolivre";
import { describeMercadoLivreListingStatus } from "@/lib/integrations/mercadolivre-listing-status";
import { syncMercadoLivreShipmentForVenda } from "@/lib/integrations/mercadolivre-shipping";
import { applyMercadoLivrePriceToErp, getMercadoLivrePriceState } from "@/lib/integrations/mercadolivre-price-sync";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function syncMercadoLivreProductLinks(providedLinks?: any[]) {
  let links = providedLinks;
  if (!links) {
    const result = await supabaseAdmin
      .from("mercadolivre_product_link")
      .select("id, empresa_id, produto_id, ml_item_id, ml_variation_id, title, permalink, status, user_product_id, family_id, family_name, domain_id, catalog_product_id, user_product_enabled, item_tags, visits_total, sold_quantity, available_quantity, listing_type_id, item_condition, health, catalog_listing, stop_time, metrics_updated_at, updated_at, raw_item, produto:produto(precovenda)")
      .order("updated_at", { ascending: true })
      .limit(100);
    if (result.error) throw result.error;
    links = result.data ?? [];
  }
  if (!links.length) return [];

  const empresaIds = Array.from(new Set(links.map((link) => Number(link.empresa_id)).filter((id) => Number.isFinite(id) && id > 0)));
  const { data: accounts, error: accountsError } = await supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, access_token, refresh_token, expires_at")
    .in("empresa_id", empresaIds);
  if (accountsError) throw accountsError;

  const accountTokens = await Promise.all(
    (accounts ?? []).map(async (account: any) => [
      Number(account.empresa_id),
      await ensureValidAccessToken(account).catch(() => ""),
    ] as const),
  );
  const tokenByEmpresa = new Map(accountTokens);
  const visitsByItem = await loadListingVisits(links, tokenByEmpresa);

  return Promise.all(
    links.map(async (link) => {
      const accessToken = tokenByEmpresa.get(Number(link.empresa_id));
      if (!accessToken || !link.ml_item_id) return { ...link, sync_error: "Conta Mercado Livre não encontrada." };

      try {
        const item = await mercadoLivreApiGet<any>(accessToken, `/items/${encodeURIComponent(String(link.ml_item_id))}`);
        // Anúncio excluído não tem preço para conciliar nem métrica para guardar:
        // o vínculo sai e o produto volta a ficar livre para ser anunciado.
        const removal = await removeLinkWhenGone(link, item);
        if (removal) return removal;
        const userProduct = item?.user_product_id && (!link.family_id || link.user_product_id !== item.user_product_id)
          ? await mercadoLivreApiGet<any>(accessToken, `/user-products/${encodeURIComponent(String(item.user_product_id))}`).catch(() => null)
          : null;
        const produto = Array.isArray(link.produto) ? link.produto[0] : link.produto;
        const erpPrice = Number(produto?.precovenda);
        const priceState = await getMercadoLivrePriceState(accessToken, String(link.ml_item_id), item);
        const mercadoLivrePrice = priceState.standardPrice;
        if (
          Number.isFinite(erpPrice) &&
          mercadoLivrePrice != null &&
          Math.abs(erpPrice - mercadoLivrePrice) >= 0.01
        ) {
          const previousMlPrice = Number(link.raw_item?.price);
          await applyMercadoLivrePriceToErp({
            productLinkId: Number(link.id),
            price: mercadoLivrePrice,
            source: "CRON_RECONCILIACAO",
            mlPriceBefore: Number.isFinite(previousMlPrice) ? previousMlPrice : null,
          });
        }
        const synchronized = {
          ...link,
          status: item?.status ?? link.status,
          title: item?.title ?? link.title,
          permalink: item?.permalink ?? link.permalink,
          user_product_id: item?.user_product_id ?? link.user_product_id ?? null,
          family_id: userProduct?.family_id ?? item?.family_id ?? link.family_id ?? null,
          family_name: item?.family_name ?? userProduct?.family_name ?? link.family_name ?? null,
          domain_id: item?.domain_id ?? userProduct?.domain_id ?? link.domain_id ?? null,
          catalog_product_id: item?.catalog_product_id ?? userProduct?.catalog_product_id ?? link.catalog_product_id ?? null,
          user_product_enabled: Boolean(item?.family_name || item?.user_product_id),
          item_tags: Array.isArray(item?.tags) ? item.tags : link.item_tags ?? [],
          visits_total: visitsByItem.get(String(link.ml_item_id).toUpperCase()) ?? link.visits_total ?? null,
          sold_quantity: numberOrNull(item?.sold_quantity) ?? link.sold_quantity ?? null,
          available_quantity: numberOrNull(item?.available_quantity) ?? link.available_quantity ?? null,
          listing_type_id: item?.listing_type_id ?? link.listing_type_id ?? null,
          item_condition: item?.condition ?? link.item_condition ?? null,
          health: numberOrNull(item?.health) ?? link.health ?? null,
          catalog_listing: typeof item?.catalog_listing === "boolean" ? item.catalog_listing : link.catalog_listing ?? null,
          stop_time: item?.stop_time ?? link.stop_time ?? null,
          metrics_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabaseAdmin
          .from("mercadolivre_product_link")
          .update({
            status: synchronized.status,
            title: synchronized.title,
            permalink: synchronized.permalink,
            user_product_id: synchronized.user_product_id,
            family_id: synchronized.family_id,
            family_name: synchronized.family_name,
            domain_id: synchronized.domain_id,
            catalog_product_id: synchronized.catalog_product_id,
            user_product_enabled: synchronized.user_product_enabled,
            item_tags: synchronized.item_tags,
            visits_total: synchronized.visits_total,
            sold_quantity: synchronized.sold_quantity,
            available_quantity: synchronized.available_quantity,
            listing_type_id: synchronized.listing_type_id,
            item_condition: synchronized.item_condition,
            health: synchronized.health,
            catalog_listing: synchronized.catalog_listing,
            stop_time: synchronized.stop_time,
            metrics_updated_at: synchronized.metrics_updated_at,
            raw_item: { ...(item ?? {}), ...(userProduct ? { _erp_user_product: userProduct } : {}), _erp_price_state: priceState },
            updated_at: synchronized.updated_at,
          })
          .eq("id", link.id);
        if (error) throw error;
        return synchronized;
      } catch (error: any) {
        // Um 404 é resposta, não falha: sem isso o vínculo de um anúncio já
        // apagado ficava tentando de novo a cada hora, para sempre.
        if (isMercadoLivreNotFound(error)) {
          const removed = await deleteProductLink(link, "O anúncio não existe mais no Mercado Livre.");
          if (removed) return removed;
        }
        return { ...link, sync_error: error?.message || "Falha ao sincronizar anúncio." };
      }
    }),
  );
}

/** Remove o vínculo quando o Mercado Livre confirma que o anúncio foi excluído. */
async function removeLinkWhenGone(link: any, item: any) {
  const state = describeMercadoLivreListingStatus({
    status: item?.status,
    subStatus: item?.sub_status,
    tags: item?.tags,
  });
  if (!state.deleted) return null;
  return await deleteProductLink(link, "Anúncio excluído no Mercado Livre.");
}

async function deleteProductLink(link: any, reason: string) {
  const { error } = await supabaseAdmin.from("mercadolivre_product_link").delete().eq("id", link.id);
  if (error) return { ...link, sync_error: error.message };

  console.info("mercado-livre vínculo removido", {
    empresa_id: link.empresa_id,
    produto_id: link.produto_id,
    ml_item_id: link.ml_item_id,
    reason,
  });
  return { ...link, removed: true, removal_reason: reason };
}

export async function syncMercadoLivreListingMetricsHistory(params?: { days?: number; limit?: number }) {
  const days = Math.min(Math.max(params?.days ?? 30, 1), 150);
  const limit = Math.min(Math.max(params?.limit ?? 10, 1), 50);
  const staleBefore = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: links, error: linksError } = await supabaseAdmin
    .from("mercadolivre_product_link")
    .select("id, empresa_id, ml_item_id, sold_quantity, available_quantity, metrics_history_updated_at")
    .or(`metrics_history_updated_at.is.null,metrics_history_updated_at.lt.${staleBefore}`)
    .order("metrics_history_updated_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (linksError) throw linksError;
  if (!links?.length) return [];

  const empresaIds = Array.from(new Set(links.map((link: any) => Number(link.empresa_id)).filter((id) => id > 0)));
  const { data: accounts, error: accountsError } = await supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, access_token, refresh_token, expires_at")
    .in("empresa_id", empresaIds);
  if (accountsError) throw accountsError;

  const tokens = await Promise.all(
    (accounts ?? []).map(async (account: any) => [Number(account.empresa_id), await ensureValidAccessToken(account).catch(() => "")] as const),
  );
  const tokenByEmpresa = new Map(tokens);
  const results = [];

  for (const link of links as any[]) {
    const accessToken = tokenByEmpresa.get(Number(link.empresa_id));
    if (!accessToken) {
      results.push({ itemId: link.ml_item_id, ok: false, error: "Conta Mercado Livre não encontrada." });
      continue;
    }

    try {
      const history = await mercadoLivreApiGet<any>(
        accessToken,
        `/items/${encodeURIComponent(String(link.ml_item_id))}/visits/time_window?last=${days}&unit=day`,
      );
      const rows = (Array.isArray(history?.results) ? history.results : [])
        .map((metric: any) => {
          const metricDate = normalizeMetricDate(metric?.date);
          if (!metricDate) return null;
          return {
            empresa_id: Number(link.empresa_id),
            product_link_id: Number(link.id),
            metric_date: metricDate,
            visits: Math.max(Math.trunc(Number(metric?.total ?? 0) || 0), 0),
            sold_quantity_total: numberOrNull(link.sold_quantity),
            available_quantity: numberOrNull(link.available_quantity),
            raw_metric: metric ?? {},
            collected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        })
        .filter(Boolean);

      if (rows.length) {
        const { error: historyError } = await supabaseAdmin
          .from("mercadolivre_listing_metric_daily")
          .upsert(rows, { onConflict: "product_link_id,metric_date" });
        if (historyError) throw historyError;
      }

      const updatedAt = new Date().toISOString();
      const { error: updateError } = await supabaseAdmin
        .from("mercadolivre_product_link")
        .update({ metrics_history_updated_at: updatedAt })
        .eq("id", link.id);
      if (updateError) throw updateError;
      results.push({ itemId: link.ml_item_id, days: rows.length, ok: true });
    } catch (error: any) {
      results.push({ itemId: link.ml_item_id, ok: false, error: error?.message || "Falha ao coletar histórico de visitas." });
    }
  }

  return results;
}

function normalizeMetricDate(value: unknown) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

async function loadListingVisits(links: any[], tokenByEmpresa: Map<number, string>) {
  const visits = new Map<string, number>();
  const linksByEmpresa = new Map<number, any[]>();
  for (const link of links) {
    const empresaId = Number(link.empresa_id);
    const current = linksByEmpresa.get(empresaId) ?? [];
    current.push(link);
    linksByEmpresa.set(empresaId, current);
  }

  await Promise.all(
    Array.from(linksByEmpresa.entries()).map(async ([empresaId, companyLinks]) => {
      const accessToken = tokenByEmpresa.get(empresaId);
      if (!accessToken) return;

      for (const batch of chunks(companyLinks.map((link) => String(link.ml_item_id ?? "").toUpperCase()).filter(Boolean), 20)) {
        try {
          const result = await mercadoLivreApiGet<Record<string, number>>(accessToken, `/visits/items?ids=${encodeURIComponent(batch.join(","))}`);
          for (const [itemId, total] of Object.entries(result ?? {})) {
            const value = Number(total);
            if (Number.isFinite(value)) visits.set(itemId.toUpperCase(), value);
          }
        } catch (error) {
          console.warn("Falha ao sincronizar visitas dos anúncios Mercado Livre", { empresaId, error });
        }
      }
    }),
  );

  return visits;
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function syncRecentMercadoLivreShipments(limit = 100) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_order")
    .select("id, venda_id, ml_order_id")
    .not("account_id", "is", null)
    .not("venda_id", "is", null)
    .not("ml_shipment_id", "is", null)
    .order("shipment_updated_at", { ascending: true, nullsFirst: true })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) throw error;

  const results = [];
  for (const order of data ?? []) {
    try {
      await syncMercadoLivreShipmentForVenda(Number(order.venda_id));
      results.push({ orderId: Number(order.ml_order_id), ok: true });
    } catch (error: any) {
      results.push({ orderId: Number(order.ml_order_id), ok: false, error: error?.message || "Falha ao sincronizar envio." });
    }
  }
  return results;
}

async function ensureValidAccessToken(account: any) {
  const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  if (!account.refresh_token || !expiresAt || expiresAt - Date.now() >= 5 * 60 * 1000) return String(account.access_token ?? "");

  const token = await refreshMercadoLivreToken(String(account.refresh_token));
  const { error } = await supabaseAdmin
    .from("mercadolivre_account")
    .update({
      access_token: token.access_token,
      refresh_token: token.refresh_token ?? account.refresh_token,
      token_type: token.token_type ?? null,
      scope: token.scope ?? null,
      expires_at: tokenExpiresAt(token.expires_in),
      raw_token: mercadoLivreTokenMetadata(token),
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);
  if (error) throw error;
  return token.access_token;
}
