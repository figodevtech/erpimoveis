import { normalizeMercadoLivreTopic } from "./mercadolivre-notification-topic";
import type { SystemNotificationInput } from "@/lib/system-notifications";
import { mercadoLivreNotificationEventForTopic } from "@/lib/integrations/mercadolivre-notification-events";
import { publicCandidateStatus } from "@/lib/integrations/mercadolivre-public-candidates";

type NotificationDetails = Record<string, any> | null | undefined;

export function mercadoLivreSystemNotification(input: {
  notificationId: number;
  topic: string;
  resource: string;
  details?: NotificationDetails;
}): SystemNotificationInput | null {
  const topic = normalizeMercadoLivreTopic(input.topic);
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

  if (topic === "stock-locations" || details.stockChange) {
    const stockChange = details.stockChange;
    // Sem variação real de quantidade não há o que avisar: o dado já foi
    // sincronizado e ninguém precisa ser interrompido por uma ressincronização.
    if (!stockChange) return null;

    const item = details.item ?? details.stock ?? details;
    const itemId = text(stockChange.itemId ?? item?.id) || resourceId;
    const itemTitle = clean(stockChange.itemTitle ?? item?.title ?? item?.name ?? item?.family_name);
    const previousQuantity = stockQuantity(stockChange.previousQuantity);
    const currentQuantity = stockQuantity(stockChange.currentQuantity ?? item?.available_quantity);
    const delta = stockDelta(stockChange.delta, previousQuantity, currentQuantity);

    // Saída de estoque por venda já foi anunciada pela notificação de pedido.
    // Sobram os dois casos acionáveis: o anúncio esgotou, ou alguém repôs por
    // fora do ERP — e aí o saldo dos dois lados deixou de bater.
    const soldOut = currentQuantity === 0;
    const restocked = delta != null && delta > 0;
    if (!soldOut && !restocked) return null;

    return {
      ...base,
      priority: soldOut ? "WARNING" : "SUCCESS",
      title: soldOut ? "Anúncio esgotado no Mercado Livre" : "Estoque adicionado no Mercado Livre",
      message: compactLines([
        itemTitle,
        labelValue("Anúncio", itemId),
        joinParts([
          labelValue("Estoque anterior", previousQuantity),
          labelValue("Movimentação", formatStockDelta(delta)),
          labelValue("Estoque atual", currentQuantity),
        ]),
      ], itemId ? `O estoque do anúncio ${itemId} recebeu uma atualização.` : "O estoque de um anúncio recebeu uma atualização."),
      href: "/marketplace?canal=mercadolivre&secao=listings",
    };
  }

  if (details.listingRemoved) {
    const removal = details.listingRemoved;
    const itemId = text(removal?.itemId) || resourceId;
    const produtos = Array.isArray(removal?.produtos) ? removal.produtos.filter(Boolean) : [];
    return {
      ...base,
      title: "Anúncio excluído no Mercado Livre",
      message: compactLines(
        [
          produtos.join(" · "),
          joinParts([
            labelValue("Anúncio", itemId),
            "O vínculo foi removido e o produto voltou a ficar livre para ser anunciado.",
          ]),
        ],
        `O anúncio ${itemId ?? ""} foi excluído no Mercado Livre e o vínculo com o produto foi removido.`.trim(),
      ),
      href: "/marketplace?canal=mercadolivre&secao=products",
    };
  }

  if (topic === "public_candidates") {
    const candidate = details.candidate;
    if (publicCandidateStatus(candidate) !== "candidate") return null;

    const item = details.item;
    const promotion = details.promotion;
    const itemId = text(candidate?.item_id ?? item?.id);
    const candidateId = text(candidate?.id);
    const startsAt = formatDay(promotion?.start_date);
    const endsAt = formatDay(promotion?.finish_date);
    return {
      ...base,
      // O Mercado Livre reenvia o mesmo convite de tempos em tempos; um aviso
      // por convite basta, e a chave única por usuário descarta as repetições.
      sourceEventId: candidateId ? `public_candidates:${candidateId}` : base.sourceEventId,
      title: "Anúncio convidado para promoção no Mercado Livre",
      message: compactLines([
        clean(item?.title),
        joinParts([
          labelValue("Promoção", promotion?.name),
          labelValue("Tipo", promotionTypeLabel(candidate?.type ?? promotion?.type)),
        ]),
        joinParts([labelValue("Anúncio", itemId), ...promotionPrice(promotion, item?.currency_id)]),
        joinParts([
          labelValue("Desconto do Mercado Livre", formatPercent(promotion?.meli_percentage)),
          labelValue("Seu desconto", formatPercent(promotion?.seller_percentage)),
        ]),
        labelValue("Período", startsAt && endsAt ? `${startsAt} a ${endsAt}` : startsAt ? `a partir de ${startsAt}` : endsAt ? `até ${endsAt}` : null),
      ], itemId ? `O anúncio ${itemId} foi convidado para uma promoção.` : "Um anúncio foi convidado para uma promoção."),
      href: "/marketplace?canal=mercadolivre&secao=listings",
    };
  }

  if (["items", "items_prices", "public_offers", "user-products-families"].includes(topic)) {
    const change = details.materialChange ?? details.familyChange;
    // O tópico dispara a cada campo alterado no anúncio. Sem mudança que alguém
    // precise ver, o dado é sincronizado em silêncio.
    if (!change) return null;

    const item = details.item ?? details.userProduct ?? details.stock ?? details;
    const itemId = text(item?.id) || resourceId;
    const itemTitle = clean(item?.title ?? item?.name ?? item?.family_name);
    const changes = change.changes ?? {};
    return {
      ...base,
      priority: clean(changes.status?.after)?.toLowerCase() === "paused" ? "WARNING" : undefined,
      title: listingChangeTitle(changes, topic),
      message: compactLines([
        itemTitle,
        joinParts([
          labelValue("Anúncio", itemId),
          changes.status ? labelValue("Situação", `${humanStatus(changes.status.before) ?? "—"} → ${humanStatus(changes.status.after)}`) : null,
          changes.price
            ? labelValue("Preço", `${formatMoney(changes.price.before, item?.currency_id) ?? "—"} → ${formatMoney(changes.price.after, item?.currency_id)}`)
            : labelValue("Preço", formatMoney(item?.price ?? item?.base_price, item?.currency_id)),
          changes.stock ? labelValue("Estoque", `${changes.stock.before} → ${changes.stock.after}`) : null,
        ]),
        changes.title ? labelValue("Título anterior", changes.title.before) : null,
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

/**
 * O título antigo — "Anúncio do Mercado Livre atualizado" — não dizia o que
 * mudou, então todo aviso exigia abrir a tela para descobrir se importava.
 */
function listingChangeTitle(changes: Record<string, any>, topic: string) {
  const status = clean(changes.status?.after)?.toLowerCase();
  if (status === "paused") return "Anúncio pausado no Mercado Livre";
  if (status === "active") return "Anúncio reativado no Mercado Livre";
  if (status === "closed") return "Anúncio encerrado no Mercado Livre";
  if (changes.price) return "Preço alterado no Mercado Livre";
  if (changes.stock) return Number(changes.stock.after) === 0 ? "Anúncio esgotado no Mercado Livre" : "Estoque reposto no Mercado Livre";
  if (changes.title) return "Título do anúncio alterado no Mercado Livre";
  if (topic === "user-products-families") return "Ficha do produto atualizada no Mercado Livre";
  return "Anúncio do Mercado Livre atualizado";
}

const PROMOTION_TYPES: Record<string, string> = {
  SMART: "co-participação", DEAL: "campanha", MARKETPLACE_CAMPAIGN: "campanha do Mercado Livre",
  LIGHTNING: "oferta relâmpago", DOD: "oferta do dia", VOLUME: "desconto por quantidade",
  PRE_NEGOTIATED: "desconto pré-acordado", PRICE_MATCHING: "preço competitivo",
  PRICE_MATCHING_MELI_ALL: "preço competitivo", UNHEALTHY_STOCK: "liquidação de estoque Full",
  SELLER_CAMPAIGN: "campanha do vendedor", SELLER_COUPON_CAMPAIGN: "cupom do vendedor",
  PRICE_DISCOUNT: "desconto no preço",
};

function promotionTypeLabel(value: unknown) {
  const type = clean(value);
  return type ? PROMOTION_TYPES[type.toUpperCase()] ?? type.replaceAll("_", " ").toLowerCase() : null;
}

/**
 * Co-participação já vem com o preço calculado; campanha só traz a faixa que
 * o vendedor pode escolher e um valor sugerido.
 */
function promotionPrice(promotion: any, currency: unknown) {
  const original = positiveMoney(promotion?.original_price, currency);
  const price = positiveMoney(promotion?.price, currency);
  if (price) return [labelValue("Preço", `${original ?? "—"} → ${price}`)];
  const suggested = positiveMoney(promotion?.suggested_discounted_price, currency);
  const min = positiveMoney(promotion?.min_discounted_price, currency);
  const max = positiveMoney(promotion?.max_discounted_price, currency);
  return [
    suggested ? labelValue("Preço sugerido", `${original ?? "—"} → ${suggested}`) : labelValue("Preço", original),
    min && max ? labelValue("Faixa permitida", `${min} a ${max}`) : null,
  ];
}

function positiveMoney(value: unknown, currency: unknown) {
  return Number(value) > 0 ? formatMoney(value, clean(currency) ?? undefined) : null;
}

function formatPercent(value: unknown) {
  const percent = Number(value);
  if (value == null || value === "" || !Number.isFinite(percent)) return null;
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(percent)}%`;
}

function formatDay(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Fortaleza" }).format(date);
}

function stockQuantity(value: unknown) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? Math.trunc(quantity) : null;
}

function stockDelta(value: unknown, previous: number | null, current: number | null) {
  const delta = Number(value);
  if (Number.isFinite(delta)) return Math.trunc(delta);
  return previous != null && current != null ? current - previous : null;
}

function formatStockDelta(delta: number | null) {
  if (delta == null) return null;
  if (delta > 0) return `+${delta} adicionados`;
  if (delta < 0) return `${Math.abs(delta)} removidos`;
  return "Sem alteração de quantidade";
}

function notificationMetadata(topic: string, resource: string, resourceId: string | null, details: NotificationDetails) {
  const question = details?.question ?? (topic === "questions" ? details : null);
  const item = details?.item;
  const order = details?.order ?? (["orders", "orders_v2", "feedback"].some((value) => topic.includes(value)) ? details : null);
  return {
    topic,
    // O evento é o que o usuário liga e desliga na tela; guardá-lo aqui evita
    // reimplementar a tradução de tópico em SQL na entrega do Telegram.
    event: mercadoLivreNotificationEventForTopic(topic),
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
