import { readJsonResponse } from "@/lib/read-json-response";
import { storefrontFetch } from "@/lib/integrations/storefront-http";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
export async function refreshSiteRefundStatus(empresaId: number, siteOrderId: number) {
  const baseUrl = process.env.STOREFRONT_API_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.STOREFRONT_ORDER_SYNC_SECRET?.trim();
  if (!baseUrl || !secret) throw new Error("Integração da loja não configurada.");
  const response = await storefrontFetch(`${baseUrl}/api/integrations/erp/orders/${siteOrderId}`, {
    headers: { Authorization: `Bearer ${secret}` }, cache: "no-store", signal: AbortSignal.timeout(20_000),
  });
  const status = await readJsonResponse(response, "Loja");
  if (!response.ok) throw new Error(status.error || "Falha ao consultar estorno.");
  const { data: link, error } = await supabaseAdmin.from("site_order_link").select("venda_id")
    .eq("empresa_id", empresaId).eq("site_order_id", siteOrderId).single();
  if (error) throw error;
  const { error: updateError } = await supabaseAdmin.from("site_order_link").update({
    refund_status: status.refundStatus || status.gatewayStatus, refund_denial_reason: status.denialReason || null, refund_requested_at: status.requestedAt, refund_reason: status.reason,
    refund_checked_at: new Date().toISOString(),
  }).eq("empresa_id", empresaId).eq("site_order_id", siteOrderId);
  if (updateError) throw updateError;
  if (status.gatewayStatus === "REFUNDED" && link.venda_id) {
    const { data: sale, error: saleError } = await supabaseAdmin.from("venda").select("status, status_entrega").eq("id",link.venda_id).single();
    if (saleError) throw saleError;
    if (status.requiresPhysicalReturn || ["ENVIO", "ENVIADO", "ENTREGUE"].includes(String(sale.status_entrega))) {
      return { ...status, requiresPhysicalReturn: true };
    }
    if (!["CANCELADA","CANCELADO"].includes(String(sale.status))) {
      const { error: cancelError } = await supabaseAdmin.rpc("cancelar_venda", { p_venda_id: link.venda_id, p_motivo: status.reason || "Estorno confirmado no Asaas", p_cancelada_by: null });
      if (cancelError) throw cancelError;
    }
    const { error: linkError } = await supabaseAdmin.from("site_order_link").update({site_status:"CANCELADO"}).eq("empresa_id",empresaId).eq("site_order_id",siteOrderId);
    if(linkError) throw linkError;
  }
  return status;
}
