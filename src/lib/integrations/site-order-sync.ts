import { storefrontFetch } from "@/lib/integrations/storefront-http";
import { refreshSiteRefundStatus } from "@/lib/integrations/site-refund-status";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { notifySalesUsers } from "@/lib/system-notifications";
import { processTelegramMarketplaceNotifications } from "@/lib/integrations/telegram-marketplace-notifications";
const itemSchema = z.object({
  produtoId: z.coerce.number().int().positive(),
  quantidade: z.coerce.number().int().positive(),
  subTotal: z.coerce.number().nonnegative(),
  valorTotal: z.coerce.number().nonnegative(),
  valorDesconto: z.coerce.number().nonnegative().default(0),
  valorFrete: z.coerce.number().nonnegative().default(0),
  baixarEstoque: z.boolean().default(true),
});

const orderSchema = z.object({
  id: z.coerce.number().int().positive(),
  status: z.literal("PAGO"),
  subtotal: z.coerce.number().positive(),
  total: z.coerce.number().positive(),
  paymentMethod: z.string().trim().max(100).nullish(),
  paymentProvider: z.string().trim().max(60).nullish(),
  gatewayPaymentId: z.string().trim().max(200).nullish(),
  createdAt: z.string().datetime({ offset: true }),
  shippingAddress: z.record(z.string(), z.unknown()),
  customer: z.object({
    id: z.coerce.number().int().positive(),
    type: z.enum(["FISICA", "JURIDICA"]),
    document: z.string().trim().min(11).max(18),
    name: z.string().trim().min(1).max(300),
    email: z.string().email().max(320),
    phone: z.string().trim().min(8).max(30),
  }),
  items: z.array(itemSchema).min(1).max(200),
});

const storefrontResponseSchema = z.object({
  data: z.array(orderSchema),
  count: z.coerce.number().int().nonnegative(),
});

export async function syncSiteOrders(empresaId: number, orderId?: number) {
    const { data: pendingRefunds, error: refundError } = await supabaseAdmin.from("site_order_link")
      .select("site_order_id").eq("empresa_id",empresaId).not("refund_requested_at","is",null).neq("site_status","CANCELADO").limit(100);
    if(refundError) throw refundError;
    for (const refund of pendingRefunds || []) await refreshSiteRefundStatus(empresaId, Number(refund.site_order_id));
    const baseUrl = process.env.STOREFRONT_API_URL?.trim().replace(/\/+$/, "");
    const secret = process.env.STOREFRONT_ORDER_SYNC_SECRET?.trim();
    if (!baseUrl || !secret) throw new Error("Configure a integração de pedidos da loja no ERP.");

    const response = await storefrontFetch(`${baseUrl}/api/integrations/erp/orders?limit=100${orderId ? `&orderId=${orderId}` : ""}`, {
      headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const raw = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(raw?.error || `A loja respondeu HTTP ${response.status}.`);
    }

    const parsed = storefrontResponseSchema.safeParse(raw);
    if (!parsed.success) throw new Error("A loja retornou pedidos em formato inválido.");

    const results: Array<{ siteOrderId: number; vendaId: number | null; imported: boolean; error?: string }> = [];
    for (const order of parsed.data.data) {
      const { data: existing } = await supabaseAdmin
        .from("site_order_link")
        .select("venda_id")
        .eq("empresa_id", empresaId)
        .eq("site_order_id", order.id)
        .maybeSingle();

      const { data: vendaId, error } = await supabaseAdmin.rpc("fn_importar_pedido_site", {
        p_empresa_id: empresaId,
        p_pedido: order,
      });

      if (error) {
        console.error(`[site/orders] Falha ao importar pedido ${order.id}:`, error);
        await supabaseAdmin.from("site_order_link").upsert({
          empresa_id: empresaId,
          site_order_id: order.id,
          site_customer_id: order.customer.id,
          site_status: order.status,
          payment_provider: order.paymentProvider || null,
          gateway_payment_id: order.gatewayPaymentId || null,
          total_amount: order.total,
          order_created_at: order.createdAt,
          import_status: "ERRO",
          import_error: error.message,
          raw_order: order,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "empresa_id,site_order_id" });
        results.push({ siteOrderId: order.id, vendaId: null, imported: false, error: error.message });
        continue;
      }

      // Upsert deduplicates per recipient/order, and lets a later sync retry
      // notification creation if a previous delivery failed after importing.
      const sourceEventId = `SITE_ORDER:${empresaId}:${order.id}`;
      try {
        await notifySalesUsers({
          category: "MARKETPLACE",
          priority: "SUCCESS",
          title: "Novo pedido pago no Site",
          message: `Pedido #${order.id} de ${order.customer.name}. Total: ${order.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Pagamento: ${order.paymentMethod || "Asaas"}.`,
          href: "/marketplace?canal=loja&secao=orders",
          source: "SITE_ORDER",
          sourceEventId,
          metadata: { empresaId, siteOrderId: order.id, vendaId: Number(vendaId) },
        });
        await processTelegramMarketplaceNotifications({ sourceEventId });
      } catch (notificationError) {
        console.error(`[site/orders] Falha ao notificar pedido ${order.id}:`, notificationError);
      }

      results.push({
        siteOrderId: order.id,
        vendaId: Number(vendaId),
        imported: !existing?.venda_id,
      });
    }

    return {
      ok: true,
      received: parsed.data.count,
      imported: results.filter((item) => item.imported).length,
      errors: results.filter((item) => item.error).length,
      results,
    };
}
