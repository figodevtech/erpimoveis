import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ produtoId: string }> };

export async function GET(_req: NextRequest, context: Params) {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const { produtoId: rawProdutoId } = await context.params;
    const produtoId = Number(rawProdutoId);
    if (!Number.isInteger(produtoId) || produtoId <= 0) {
      return NextResponse.json({ error: "Produto inválido." }, { status: 400 });
    }

    const { data: link, error: linkError } = await supabaseAdmin
      .from("mercadolivre_product_link")
      .select("id, produto_id, ml_item_id, title, permalink, status, user_product_id, family_name, visits_total, sold_quantity, available_quantity, listing_type_id, item_condition, health, catalog_listing, metrics_updated_at, metrics_history_updated_at")
      .eq("empresa_id", empresaId)
      .eq("produto_id", produtoId)
      .maybeSingle();
    if (linkError) throw linkError;
    if (!link) return NextResponse.json({ linked: false, data: null });

    const account = await getValidMercadoLivreAccount(empresaId);
    const itemId = String(link.ml_item_id);
    const [item, itemPerformance, userProductPerformance, { data: dailyMetrics }, { data: orders }] = await Promise.all([
      mercadoLivreApiGet<any>(account.access_token, `/items/${encodeURIComponent(itemId)}`),
      mercadoLivreApiGet<any>(account.access_token, `/item/${encodeURIComponent(itemId)}/performance`).catch(() => null),
      link.user_product_id
        ? mercadoLivreApiGet<any>(account.access_token, `/user-product/${encodeURIComponent(String(link.user_product_id))}/performance`).catch(() => null)
        : Promise.resolve(null),
      supabaseAdmin
        .from("mercadolivre_listing_metric_daily")
        .select("metric_date, visits, collected_at")
        .eq("empresa_id", empresaId)
        .eq("product_link_id", Number(link.id))
        .gte("metric_date", startDate(29))
        .order("metric_date", { ascending: true }),
      supabaseAdmin
        .from("mercadolivre_order")
        .select("ml_order_id, status, payment_status, payment_status_detail, order_tags, date_created, raw_order")
        .eq("empresa_id", empresaId)
        .eq("account_id", account.id)
        .gte("date_created", `${startDate(29)}T00:00:00.000Z`)
        .order("date_created", { ascending: true })
        .limit(1000),
    ]);

    const daily = buildDailyMetrics(dailyMetrics ?? [], orders ?? [], itemId);
    const visits30d = daily.reduce((total, day) => total + day.visits, 0);
    const orders30d = daily.reduce((total, day) => total + day.orders, 0);
    const units30d = daily.reduce((total, day) => total + day.units, 0);

    return NextResponse.json({
      linked: true,
      data: {
        ...link,
        status: item?.status ?? link.status,
        picturesCount: Array.isArray(item?.pictures) ? item.pictures.length : 0,
        quality: normalizeQuality(userProductPerformance ?? itemPerformance, link.health),
        permissions: {
          title: !item?.user_product_id && !item?.catalog_listing,
          price: true,
          stock: true,
          description: true,
          pictures: !item?.catalog_listing,
          attributes: !item?.catalog_listing,
          familyControlled: Boolean(item?.user_product_id),
          catalogControlled: Boolean(item?.catalog_listing),
        },
        period: {
          days: 30,
          visits: visits30d,
          orders: orders30d,
          units: units30d,
          conversionRate: visits30d > 0 ? Number(((orders30d / visits30d) * 100).toFixed(2)) : 0,
          daily,
        },
      },
    });
  } catch (error: any) {
    console.error("GET /api/integracoes/mercadolivre/products/[produtoId]/performance", error);
    return NextResponse.json({ error: error?.message || "Falha ao carregar desempenho do anúncio." }, { status: errorStatus(error) });
  }
}

function startDate(offsetDays: number) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - offsetDays);
  return date.toISOString().slice(0, 10);
}

function buildDailyMetrics(metrics: any[], orders: any[], itemId: string) {
  const days = new Map<string, { date: string; visits: number; orders: number; units: number }>();
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = startDate(offset);
    days.set(date, { date, visits: 0, orders: 0, units: 0 });
  }
  for (const metric of metrics) {
    const day = days.get(String(metric.metric_date).slice(0, 10));
    if (day) day.visits += Math.max(Number(metric.visits ?? 0), 0);
  }
  for (const order of orders) {
    if (!isPaidOrder(order)) continue;
    const matchingItems = (Array.isArray(order?.raw_order?.order_items) ? order.raw_order.order_items : [])
      .filter((orderItem: any) => String(orderItem?.item?.id ?? orderItem?.item_id ?? "").toUpperCase() === itemId.toUpperCase());
    if (!matchingItems.length) continue;
    const day = days.get(String(order.date_created ?? "").slice(0, 10));
    if (!day) continue;
    day.orders += 1;
    day.units += matchingItems.reduce((total: number, orderItem: any) => total + Math.max(Number(orderItem?.quantity ?? 0), 0), 0);
  }
  return Array.from(days.values());
}

function isPaidOrder(order: any) {
  const values = [order?.status, order?.payment_status, order?.payment_status_detail].map((value) => String(value ?? "").toLowerCase());
  const tags = Array.isArray(order?.order_tags) ? order.order_tags.map((tag: unknown) => String(tag).toLowerCase()) : [];
  const paid = values.some((value) => ["paid", "approved", "accredited"].includes(value));
  return paid && !values.some((value) => /cancel|refund|charged_back/.test(value)) && !tags.some((tag: string) => /cancel|refund/.test(tag));
}

function normalizeQuality(performance: any, legacyHealth: unknown) {
  const score = Number(performance?.score);
  const normalizedScore = Number.isFinite(score) ? score : Number.isFinite(Number(legacyHealth)) ? Number(legacyHealth) * 100 : null;
  const buckets = Array.isArray(performance?.buckets) ? performance.buckets : [];
  const actions = buckets.flatMap((bucket: any) =>
    (Array.isArray(bucket?.variables) ? bucket.variables : [])
      .filter((variable: any) => String(variable?.status ?? "").toUpperCase() !== "COMPLETED")
      .map((variable: any) => ({
        id: String(variable?.key ?? variable?.id ?? ""),
        title: String(variable?.title ?? variable?.name ?? variable?.key ?? "Melhoria pendente"),
        status: String(variable?.status ?? "PENDING"),
        message: String(variable?.description ?? variable?.message ?? ""),
      })),
  );
  return {
    available: Boolean(performance) || normalizedScore != null,
    score: normalizedScore,
    level: performance?.level_wording ?? performance?.level ?? null,
    calculatedAt: performance?.calculated_at ?? null,
    actions,
    raw: performance ?? null,
  };
}
