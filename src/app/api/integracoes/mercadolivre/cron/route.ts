import { NextResponse, type NextRequest } from "next/server";
import { retryMercadoLivreNotifications } from "@/lib/integrations/mercadolivre-notifications";
import { syncMercadoLivreOrders } from "@/lib/integrations/mercadolivre-orders";
import {
  syncMercadoLivreListingMetricsHistory,
  syncMercadoLivreProductLinks,
  syncRecentMercadoLivreShipments,
} from "@/lib/integrations/mercadolivre-reconciliation";
import { syncPendingMercadoLivreStock } from "@/lib/integrations/mercadolivre-stock-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const configuredSecrets = [process.env.CRON_SECRET, process.env.MERCADOLIVRE_CRON_SECRET]
      .map((value) => value?.trim())
      .filter(Boolean) as string[];
    if (configuredSecrets.length === 0 && process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "CRON_SECRET não configurado." }, { status: 503 });
    }
    if (configuredSecrets.length > 0) {
      const receivedSecret = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
      if (!receivedSecret || !configuredSecrets.includes(receivedSecret)) {
        return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
      }
    }

    const orders = await syncMercadoLivreOrders({ days: 2, limit: 50 });
    const notifications = await retryMercadoLivreNotifications(30);
    const items = await syncMercadoLivreProductLinks();
    const [shipments, stock, metrics] = await Promise.all([
      syncRecentMercadoLivreShipments(15),
      syncPendingMercadoLivreStock({ limit: 50 }),
      syncMercadoLivreListingMetricsHistory({ days: 30, limit: 10 }),
    ]);
    const created = orders.filter((item) => item.created).length;

    return NextResponse.json({
      ok: true,
      created,
      orders: summarize(orders),
      notifications: summarize(notifications),
      items: summarize(items, "sync_error"),
      shipments: summarize(shipments),
      stock: summarize(stock),
      metrics: summarize(metrics),
    });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/cron", e);
    return NextResponse.json({ error: e?.message || "Falha na rotina Mercado Livre." }, { status: 500 });
  }
}

function summarize(items: any[], errorField = "error") {
  return {
    total: items.length,
    success: items.filter((item) => !item?.[errorField] && item?.ok !== false).length,
    failed: items.filter((item) => Boolean(item?.[errorField]) || item?.ok === false).length,
  };
}
