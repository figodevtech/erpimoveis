export type MercadoLivreReturnSummary = {
  id: string | null;
  status: string | null;
  trackingNumber: string | null;
  shipmentId: number | null;
  shipmentStatus: string | null;
  destinationName: string | null;
  destinationAddress: string | null;
  totalQuantity: number | null;
  returnQuantity: number | null;
};

function nullableText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function nullableNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** Normalizes both the current Returns V2 response and the legacy return shape. */
export function normalizeMercadoLivreReturn(value: unknown): MercadoLivreReturnSummary {
  const data = value && typeof value === "object" ? (value as Record<string, any>) : {};
  const shipments = Array.isArray(data.shipments) ? data.shipments : [];
  const shipment =
    shipments.find((entry: any) => String(entry?.type ?? "").toLowerCase() === "return") ??
    shipments[0] ??
    data.shipment ??
    null;
  const destination = shipment?.destination ?? {};
  const address = destination?.shipping_address ?? destination?.address ?? {};

  return {
    id: nullableText(data.id),
    status: nullableText(data.status),
    trackingNumber: nullableText(shipment?.tracking_number ?? data.tracking_number),
    shipmentId: nullableNumber(shipment?.shipment_id ?? shipment?.id ?? data.shipment_id),
    shipmentStatus: nullableText(shipment?.status),
    destinationName: nullableText(destination?.name ?? destination?.receiver_name),
    destinationAddress: nullableText(address?.address_line ?? address?.street_name),
    totalQuantity: nullableNumber(shipment?.total_quantity),
    returnQuantity: nullableNumber(shipment?.return_quantity),
  };
}
