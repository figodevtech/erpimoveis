export type MercadoLivreMe1TrackingEvent = {
  payload: {
    service_id: number;
    comment?: string;
    date: string;
  };
  tracking_number?: string;
  tracking_url?: string;
  status: "shipped" | "delivered" | "not_delivered";
  substatus: string | null;
};

const ME1_SERVICE_ID_BY_SITE: Record<string, number> = {
  MLB: 11,
  MLA: 154,
  MLM: 231876,
  MLC: 282578,
  MCO: 282579,
  MLU: 282604,
  MPE: 361180,
};

export function getMercadoLivreMe1ServiceId(siteId: string | null | undefined) {
  const normalizedSiteId = String(siteId ?? "").trim().toUpperCase();
  const serviceId = ME1_SERVICE_ID_BY_SITE[normalizedSiteId];
  if (!serviceId) {
    throw new Error(`O país ${normalizedSiteId || "não informado"} não possui service_id ME1 configurado no ERP.`);
  }
  return serviceId;
}

export function buildMercadoLivreMe1TrackingEvent(params: {
  siteId: string | null | undefined;
  carrierLabel: string;
  date: string;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  status: string;
  substatus?: string | null;
}): MercadoLivreMe1TrackingEvent {
  const trackingNumber = String(params.trackingNumber ?? "").trim();
  const trackingUrl = String(params.trackingUrl ?? "").trim();
  if (Boolean(trackingNumber) !== Boolean(trackingUrl)) {
    throw new Error("No Mercado Envios 1, o código e o link de rastreio devem ser informados juntos.");
  }

  const status = String(params.status).trim().toLowerCase();
  if (!isMe1TrackingStatus(status)) {
    throw new Error("Status de rastreamento ME1 inválido.");
  }

  const date = new Date(params.date);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Data do evento de rastreamento ME1 inválida.");
  }

  return {
    payload: {
      service_id: getMercadoLivreMe1ServiceId(params.siteId),
      comment: params.carrierLabel ? `Enviado por ${params.carrierLabel}` : undefined,
      date: date.toISOString(),
    },
    ...(trackingNumber && trackingUrl
      ? { tracking_number: trackingNumber, tracking_url: trackingUrl }
      : {}),
    status,
    // A API V2 exige a presença do campo, inclusive quando não há substatus.
    substatus: params.substatus ? String(params.substatus).trim().toLowerCase() : null,
  };
}

function isMe1TrackingStatus(status: string): status is MercadoLivreMe1TrackingEvent["status"] {
  return status === "shipped" || status === "delivered" || status === "not_delivered";
}
