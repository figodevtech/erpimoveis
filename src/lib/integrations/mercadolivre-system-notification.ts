import type { SystemNotificationInput } from "@/lib/system-notifications";

type NotificationDetails = Record<string, any> | null | undefined;

export function mercadoLivreSystemNotification(input: {
  notificationId: number;
  topic: string;
  resource: string;
  details?: NotificationDetails;
}): SystemNotificationInput | null {
  const topic = input.topic.toLowerCase();
  const resourceId = input.resource.split("?")[0].split("/").filter(Boolean).pop() || null;
  const details = input.details ?? {};
  const base = {
    category: "MARKETPLACE" as const,
    source: "MERCADOLIVRE_WEBHOOK",
    sourceEventId: String(input.notificationId),
    metadata: notificationMetadata(topic, input.resource, resourceId, details),
  };

  if (topic === "orders_v2" || topic === "orders") {
    const order = details.order ?? details;
    const orderId = text(order?.id) || resourceId;
    return {
      ...base,
      priority: "SUCCESS",
      title: `Pedido ${orderId ? `#${orderId} ` : ""}atualizado`,
      message: compactLines([
        orderItemsSummary(order),
        joinParts([
          labelValue("Total", formatMoney(order?.total_amount ?? order?.paid_amount, order?.currency_id)),
          labelValue("Status", humanStatus(order?.status)),
          labelValue("Pagamento", humanStatus(paymentStatus(order))),
        ]),
        labelValue("Comprador", buyerLabel(order?.buyer)),
      ], orderId ? `O pedido #${orderId} recebeu uma atualização.` : "Um pedido recebeu uma atualização."),
      href: "/marketplace?canal=mercadolivre&secao=orders",
    };
  }

  if (topic === "shipments") {
    const shipment = details.shipment ?? details;
    const order = details.order;
    const shipmentId = text(shipment?.id) || resourceId;
    const orderId = text(shipment?.order_id ?? shipment?.order?.id ?? order?.id);
    return {
      ...base,
      title: `Envio ${shipmentId ? `#${shipmentId} ` : ""}atualizado`,
      message: compactLines([
        orderItemsSummary(order),
        joinParts([
          labelValue("Pedido", orderId ? `#${orderId}` : null),
          labelValue("Status", humanStatus(shipment?.status)),
          labelValue("Etapa", humanStatus(shipment?.substatus)),
        ]),
        joinParts([
          labelValue("Transportadora", shipment?.tracking_method ?? shipment?.shipping_option?.name),
          labelValue("Rastreio", shipment?.tracking_number),
        ]),
      ], shipmentId ? `O envio #${shipmentId} mudou de situação.` : "Um envio mudou de situação."),
      href: "/marketplace?canal=mercadolivre&secao=orders",
    };
  }

  if (["items", "items_prices", "user-products-families", "stock-locations"].includes(topic)) {
    const item = details.item ?? details.userProduct ?? details.stock ?? details;
    const itemId = text(item?.id) || resourceId;
    const itemTitle = clean(item?.title ?? item?.name ?? item?.family_name);
    return {
      ...base,
      title: topic === "items_prices" ? "Preço de anúncio atualizado" : "Anúncio do Mercado Livre atualizado",
      message: compactLines([
        itemTitle,
        joinParts([
          labelValue("Anúncio", itemId),
          labelValue("Status", humanStatus(item?.status)),
          labelValue("Preço", formatMoney(item?.price ?? item?.base_price, item?.currency_id)),
          labelValue("Estoque", item?.available_quantity),
        ]),
      ], itemId ? `O anúncio ou produto ${itemId} recebeu uma atualização.` : "Um anúncio recebeu uma atualização."),
      href: "/marketplace?canal=mercadolivre&secao=listings",
    };
  }

  if (topic.includes("claim") || topic.includes("reclama")) {
    const claim = details.claim ?? details;
    const order = details.order;
    const claimId = text(claim?.id) || resourceId;
    return {
      ...base,
      priority: "WARNING",
      title: `Reclamação ${claimId ? `#${claimId}` : "no Mercado Livre"}`,
      message: compactLines([
        clean(claim?.title ?? claim?.reason?.name ?? claim?.reason?.description),
        orderItemsSummary(order?.raw_order ?? order),
        joinParts([
          labelValue("Pedido", order?.ml_order_id ?? order?.id),
          labelValue("Status", humanStatus(claim?.status ?? claim?.stage)),
          labelValue("Prazo", formatDate(claim?.due_date ?? claim?.expiration_date ?? claim?.deadline)),
        ]),
      ], claimId ? `A reclamação #${claimId} recebeu uma atualização.` : "Uma reclamação recebeu uma atualização."),
      href: "/marketplace?canal=mercadolivre&secao=atendimento",
    };
  }

  if (topic === "questions") {
    const question = details.question ?? details;
    const item = details.item;
    const questionText = quote(question?.text);
    const itemTitle = clean(item?.title);
    const itemId = text(question?.item_id ?? item?.id);
    return {
      ...base,
      priority: "WARNING",
      title: itemTitle ? `Pergunta sobre ${truncate(itemTitle, 105)}` : "Pergunta no Mercado Livre",
      message: compactLines([
        questionText,
        joinParts([
          labelValue("Anúncio", itemId),
          labelValue("Comprador", buyerLabel(question?.from)),
          labelValue("Status", humanStatus(question?.status)),
        ]),
      ], "Há uma nova pergunta ou atualização aguardando atendimento."),
      href: "/marketplace?canal=mercadolivre&secao=atendimento",
    };
  }

  if (topic === "messages" || topic === "messaging") {
    const payload = details.message ?? details;
    const latestMessage = findLatestMessage(payload);
    const order = details.order;
    const rawOrder = order?.raw_order ?? order;
    const orderId = text(order?.ml_order_id ?? rawOrder?.id ?? payload?.order_id ?? payload?.pack_id);
    return {
      ...base,
      title: orderId ? `Mensagem sobre o pedido #${orderId}` : "Mensagem de comprador",
      message: compactLines([
        quote(latestMessage?.text ?? payload?.text),
        orderItemsSummary(rawOrder),
        joinParts([
          labelValue("Comprador", buyerLabel(rawOrder?.buyer ?? latestMessage?.from)),
          labelValue("Pedido", orderId ? `#${orderId}` : null),
        ]),
      ], "Uma conversa do Mercado Livre recebeu uma nova atualização."),
      href: "/marketplace?canal=mercadolivre&secao=atendimento",
    };
  }

  if (topic.includes("feedback")) {
    const order = details.order ?? details;
    const feedback = order?.feedback ?? order?.feedback_sale ?? details.feedback;
    const orderId = text(order?.id) || resourceId;
    return {
      ...base,
      title: `Avaliação ${orderId ? `do pedido #${orderId}` : "do Mercado Livre"}`,
      message: compactLines([
        orderItemsSummary(order),
        joinParts([
          labelValue("Avaliação", feedback?.rating ?? feedback?.fulfilled),
          labelValue("Comentário", feedback?.message ?? feedback?.comment),
        ]),
      ], "Uma venda recebeu uma nova avaliação ou alteração."),
      href: "/marketplace?canal=mercadolivre&secao=atendimento",
    };
  }

  return null;
}

function notificationMetadata(topic: string, resource: string, resourceId: string | null, details: NotificationDetails) {
  const question = details?.question ?? (topic === "questions" ? details : null);
  const item = details?.item;
  const order = details?.order ?? (["orders", "orders_v2", "feedback"].some((value) => topic.includes(value)) ? details : null);
  return {
    topic,
    resource,
    resourceId,
    questionId: text(question?.id),
    itemId: text(question?.item_id ?? item?.id),
    itemTitle: clean(item?.title) || firstItemTitle(order),
    orderId: text(order?.ml_order_id ?? order?.id),
  };
}

function orderItemsSummary(order: any) {
  const items = Array.isArray(order?.order_items) ? order.order_items : [];
  if (!items.length) return null;
  const summaries = items.slice(0, 3).map((entry: any) => {
    const title = clean(entry?.item?.title ?? entry?.title) || "Produto";
    const quantity = Number(entry?.quantity ?? 0);
    return `${title}${quantity > 0 ? ` (${quantity} un.)` : ""}`;
  });
  if (items.length > 3) summaries.push(`+${items.length - 3} item(ns)`);
  return `Produto${items.length > 1 ? "s" : ""}: ${summaries.join(", ")}`;
}

function firstItemTitle(order: any) {
  const items = Array.isArray(order?.order_items) ? order.order_items : [];
  return clean(items[0]?.item?.title ?? items[0]?.title);
}

function paymentStatus(order: any) {
  const payments = Array.isArray(order?.payments) ? order.payments : [];
  return payments[0]?.status ?? order?.payment_status;
}

function findLatestMessage(payload: any) {
  const messages = Array.isArray(payload?.messages)
    ? payload.messages
    : Array.isArray(payload?.results)
      ? payload.results
      : [];
  return messages[messages.length - 1] ?? payload?.message ?? payload;
}

function buyerLabel(buyer: any) {
  if (!buyer) return null;
  return clean(buyer.nickname ?? buyer.name) || (buyer.id || buyer.user_id ? `#${buyer.id ?? buyer.user_id}` : null);
}

function formatMoney(value: unknown, currency = "BRL") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: clean(currency) || "BRL" }).format(amount);
  } catch {
    return `R$ ${amount.toFixed(2).replace(".", ",")}`;
  }
}

function formatDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return clean(value);
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Fortaleza" }).format(date);
}

function humanStatus(value: unknown) {
  const normalized = clean(value);
  if (!normalized) return null;
  const translated: Record<string, string> = {
    paid: "pago", approved: "aprovado", confirmed: "confirmado", payment_required: "aguardando pagamento",
    ready_to_ship: "pronto para envio", shipped: "enviado", delivered: "entregue", cancelled: "cancelado",
    pending: "pendente", opened: "aberta", closed: "encerrada", unanswered: "não respondida",
    answered: "respondida", under_review: "em análise", active: "ativo", paused: "pausado",
  };
  return translated[normalized.toLowerCase()] ?? normalized.replaceAll("_", " ");
}

function quote(value: unknown) {
  const normalized = clean(value);
  return normalized ? `“${normalized}”` : null;
}

function labelValue(label: string, value: unknown) {
  const normalized = clean(value);
  return normalized ? `${label}: ${normalized}` : null;
}

function joinParts(parts: Array<string | null>) {
  const present = parts.filter(Boolean);
  return present.length ? present.join(" · ") : null;
}

function compactLines(lines: Array<string | null>, fallback: string) {
  const present = lines.map(clean).filter(Boolean);
  return truncate(present.length ? present.join("\n") : fallback, 1000);
}

function text(value: unknown) {
  if (value == null || value === "") return null;
  return String(value);
}

function clean(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized || null;
}

function truncate(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(limit - 1, 1)).trimEnd()}…`;
}
