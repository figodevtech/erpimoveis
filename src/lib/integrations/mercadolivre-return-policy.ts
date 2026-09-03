import type { MercadoLivreOrder } from "@/lib/integrations/mercadolivre";
import type { MercadoLivreShipment } from "@/lib/integrations/mercadolivre-shipping";

const PHYSICAL_RETURN_MARKER = /chargeback|charged_back|return|devolu/;
const REFUND_MARKER = /refund|reembols/;
const PRE_SHIPMENT_STATUSES = new Set(["pending", "handling", "ready_to_ship", "not_verified", "cancelled", "canceled"]);

export function shouldWaitForMercadoLivreReturnInspection(order: MercadoLivreOrder, shipment?: MercadoLivreShipment | null) {
  const payments = Array.isArray(order.payments) ? order.payments : [];
  const paymentValues = payments.flatMap((payment) => [payment?.status, payment?.status_detail]);
  const values = [order.status, order.status_detail, order.cancel_detail?.group, order.cancel_detail?.code, ...paymentValues]
    .map((value) => String(value ?? "").toLowerCase())
    .filter(Boolean);
  const tags = Array.isArray(order.tags) ? order.tags.map((tag) => String(tag).toLowerCase()) : [];

  const markers = [...values, ...tags];
  if (markers.some((value) => PHYSICAL_RETURN_MARKER.test(value))) return true;

  const hasRefund = markers.some((value) => REFUND_MARKER.test(value));
  if (!hasRefund) return false;

  const shipmentStatus = String(shipment?.status ?? "").toLowerCase();
  return !shipmentStatus || !PRE_SHIPMENT_STATUSES.has(shipmentStatus);
}
