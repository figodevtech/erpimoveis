export type OrderControl = {
  site_status?: string; import_status?: string; refund_status?: string | null;
  refund_requested_at?: string | null; return_requested_at?: string | null; return_received_at?: string | null;
  venda?: { status?: string; status_entrega?: string | null } | null;
};
export function orderStage(order: OrderControl) {
  if (order.import_status === "ERRO") return "error";
  if (String(order.refund_status).startsWith("CHARGEBACK")) return "dispute";
  if (order.refund_status === "REFUNDED" || order.site_status === "CANCELADO") return "cancelled";
  if (order.refund_status === "DENIED") return "refund-denied";
  if (order.return_requested_at) return order.return_received_at ? "return-received" : "return-pending";
  if (order.refund_requested_at) return "refund-pending";
  if (order.venda?.status_entrega === "ENTREGUE") return "delivered";
  if (["ENVIO", "ENVIADO"].includes(order.venda?.status_entrega || "")) return "shipped";
  return "preparing";
}
export function nextOrderAction(order: OrderControl) {
  const actions: Record<string, string> = {
    error: "Corrigir erro e sincronizar novamente", dispute: "Consultar contestação e reunir comprovantes no Asaas",
    cancelled: "Conferir fechamento financeiro e estoque", "refund-denied": "Consultar motivo antes de tentar novamente",
    "return-pending": "Aguardar mercadoria e conferir recebimento", "return-received": "Solicitar ou acompanhar reembolso",
    "refund-pending": order.refund_status === "AWAITING_CUSTOMER" ? "Enviar formulário do boleto ao cliente" : "Consultar confirmação do estorno",
    delivered: "Pedido entregue; devolução exige conferência", shipped: "Acompanhar entrega ou retirada", preparing: "Separar, faturar e registrar envio ou retirada",
  };
  return actions[orderStage(order)];
}
