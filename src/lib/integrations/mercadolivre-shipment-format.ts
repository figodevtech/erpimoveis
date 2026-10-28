// Leitura do envio do Mercado Livre sem depender do banco: usada pelo servidor
// e pela tela do marketplace, que precisam concordar sobre a logística.

/**
 * O ERP pede o envio com `x-format-new`, e nesse formato modo e tipo logístico
 * ficam em `logistic`, o endereço do comprador em `destination` e a promessa de
 * entrega em `lead_time`. Ler só os campos antigos deixava um envio Flex sem
 * modo nem tipo — a tela o tratava como envio personalizado e travava a NF-e.
 * Os dois formatos são aceitos porque há pedidos gravados no antigo.
 */
export function readShipmentLogistics(shipment: unknown) {
  const raw = (shipment && typeof shipment === "object" ? shipment : {}) as any;
  return {
    mode: (raw.logistic?.mode ?? raw.mode ?? null) as string | null,
    logisticType: (raw.logistic?.type ?? raw.logistic_type ?? null) as string | null,
  };
}

export function readShipmentReceiverAddress(shipment: unknown) {
  const raw = (shipment && typeof shipment === "object" ? shipment : {}) as any;
  if (raw.receiver_address && typeof raw.receiver_address === "object") return raw.receiver_address as Record<string, any>;
  const destination = raw.destination;
  const address = destination?.shipping_address;
  if (!address || typeof address !== "object") return null;
  return {
    ...address,
    receiver_name: destination.receiver_name ?? null,
    receiver_phone: destination.receiver_phone ?? null,
  } as Record<string, any>;
}

/** Logísticas em que o ML importa o XML no envio e só então libera a etiqueta. */
const LOGISTICAS_NFE_NO_ENVIO = new Set(["drop_off", "xd_drop_off", "xd_same_day", "cross_docking"]);

/**
 * Por onde a NF-e do pedido entra no Mercado Livre:
 * - `shipment`: coleta e agência; o XML vai para o envio e libera a etiqueta;
 * - `pack`: Flex, ME1 e envio personalizado; a nota é anexada ao pedido para o
 *   comprador e não mexe na etiqueta (no Brasil o ML recusa este caminho para
 *   as logísticas do item anterior);
 * - `fulfillment`: Full, em que quem emite é o próprio ML;
 * - `unknown`: o pedido tem envio, mas a logística ainda não foi sincronizada.
 */
export type MercadoLivreInvoiceChannel = "shipment" | "pack" | "fulfillment" | "unknown";

export function resolveMercadoLivreInvoiceChannel(order: {
  ml_shipment_id?: number | string | null;
  shipping_mode?: string | null;
  logistic_type?: string | null;
  raw_shipment?: unknown;
}): MercadoLivreInvoiceChannel {
  const stored = readShipmentLogistics(order.raw_shipment);
  const mode = String(order.shipping_mode ?? stored.mode ?? "").trim().toLowerCase();
  const logisticType = String(order.logistic_type ?? stored.logisticType ?? "").trim().toLowerCase();

  if (logisticType === "fulfillment") return "fulfillment";
  if (mode === "me2" && LOGISTICAS_NFE_NO_ENVIO.has(logisticType)) return "shipment";
  if (mode === "me2" && !logisticType) return "unknown";
  if (!mode && Number(order.ml_shipment_id) > 0) return "unknown";
  return "pack";
}
