import type { SystemNotificationInput } from "@/lib/system-notifications";

export function mercadoLivreSystemNotification(input: {
  notificationId: number;
  topic: string;
  resource: string;
}): SystemNotificationInput | null {
  const topic = input.topic.toLowerCase();
  const resourceId = input.resource.split("?")[0].split("/").filter(Boolean).pop() || null;
  const base = {
    category: "MARKETPLACE" as const,
    source: "MERCADOLIVRE_WEBHOOK",
    sourceEventId: String(input.notificationId),
    metadata: { topic, resource: input.resource, resourceId },
  };

  if (topic === "orders_v2" || topic === "orders") return {
    ...base,
    priority: "SUCCESS",
    title: "Pedido do Mercado Livre atualizado",
    message: resourceId ? `O pedido #${resourceId} recebeu uma atualização.` : "Um pedido recebeu uma atualização.",
    href: "/marketplace?canal=mercadolivre&secao=orders",
  };
  if (topic === "shipments") return {
    ...base,
    title: "Envio do Mercado Livre atualizado",
    message: resourceId ? `O envio #${resourceId} mudou de situação.` : "Um envio mudou de situação.",
    href: "/marketplace?canal=mercadolivre&secao=orders",
  };
  if (["items", "items_prices", "user-products-families", "stock-locations"].includes(topic)) return {
    ...base,
    title: topic === "items_prices" ? "Preço de anúncio atualizado" : "Anúncio do Mercado Livre atualizado",
    message: resourceId ? `O anúncio ou produto ${resourceId} recebeu uma atualização.` : "Um anúncio recebeu uma atualização.",
    href: "/marketplace?canal=mercadolivre&secao=listings",
  };
  if (topic.includes("claim") || topic.includes("reclama")) return {
    ...base,
    priority: "WARNING",
    title: "Reclamação no Mercado Livre",
    message: resourceId ? `A reclamação #${resourceId} recebeu uma atualização.` : "Uma reclamação recebeu uma atualização.",
    href: "/marketplace?canal=mercadolivre&secao=atendimento",
  };
  if (topic === "questions") return {
    ...base,
    priority: "WARNING",
    title: "Pergunta no Mercado Livre",
    message: "Há uma nova pergunta ou atualização aguardando atendimento.",
    href: "/marketplace?canal=mercadolivre&secao=atendimento",
  };
  if (topic === "messages" || topic === "messaging") return {
    ...base,
    title: "Mensagem de comprador",
    message: "Uma conversa do Mercado Livre recebeu uma nova atualização.",
    href: "/marketplace?canal=mercadolivre&secao=atendimento",
  };
  if (topic.includes("feedback")) return {
    ...base,
    title: "Avaliação do Mercado Livre atualizada",
    message: "Uma venda recebeu uma nova avaliação ou alteração.",
    href: "/marketplace?canal=mercadolivre&secao=atendimento",
  };
  return null;
}
