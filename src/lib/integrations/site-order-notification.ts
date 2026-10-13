type NotificationOrder = {
  id: number;
  total: number;
  paymentMethod?: string | null;
  customer: { name: string; phone: string };
  shippingAddress: Record<string, unknown>;
  items: Array<{ produtoId: number; quantidade: number; title?: string | null; reference?: string | null }>;
};

const clean = (value: unknown, limit = 180) => typeof value === "string"
  ? value.replace(/[\r\n\t]+/g, " ").trim().slice(0, limit) : "";

export function buildSiteOrderNotification(order: NotificationOrder) {
  const address = order.shippingAddress;
  const pickup = address.deliveryMethod === "pickup";
  const location = [
    [clean(address.logradouro ?? address.street), clean(address.numero ?? address.number, 20)].filter(Boolean).join(", "),
    clean(address.complemento ?? address.complement, 80), clean(address.bairro ?? address.neighborhood, 80),
    [clean(address.cidade ?? address.city, 80), clean(address.estado ?? address.state, 10)].filter(Boolean).join("/"),
    clean(address.cep ?? address.zipCode, 20) ? `CEP ${clean(address.cep ?? address.zipCode, 20)}` : "",
  ].filter(Boolean).join(" · ");
  const lines = [
    `Pedido #${order.id} — pagamento confirmado`,
    `Cliente: ${clean(order.customer.name)}`,
    `Telefone: ${clean(order.customer.phone, 30)}`,
    `Entrega: ${pickup ? "Retirada na loja" : "Envio"}`,
    ...(!pickup ? [`Endereço: ${location || "Não informado"}`] : []),
    ...(pickup && clean(address.pickupAddress) ? [`Local: ${clean(address.pickupAddress)}`] : []),
    `Total: ${order.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
    `Pagamento: ${clean(order.paymentMethod) || "Asaas"}`,
    "Produtos:",
  ];
  // system_notification.message supports 1000 characters. Keep whole item lines
  // and explicitly signal overflow rather than silently cutting a product name.
  let message = lines.join("\n");
  let shown = 0;
  for (const item of order.items) {
    const line = `${item.quantidade} × ${clean(item.title, 100) || `Produto #${item.produtoId}`}${item.reference ? ` (ref. ${clean(item.reference, 40)})` : ""}`;
    if (message.length + line.length + 65 > 1000) break;
    message += `\n${line}`;
    shown++;
  }
  if (shown < order.items.length) message += `\n+ ${order.items.length - shown} item(ns). Veja todos no ERP.`;
  return message;
}
