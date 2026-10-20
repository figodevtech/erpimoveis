import { normalizeMercadoLivreTopic } from "./mercadolivre-notification-topic";
/**
 * Catálogo de eventos do Mercado Livre que podem virar aviso. Todos são
 * implementados; quem decide o que quer ver é o usuário, na tela.
 */
export const MERCADOLIVRE_NOTIFICATION_EVENT_GROUPS = [
  {
    id: "VENDAS",
    label: "Vendas",
    description: "Pedidos, envios e avaliações de compradores",
    events: [
      ["PEDIDO", "Pedido criado ou atualizado"],
      ["ENVIO", "Envio mudou de situação"],
      ["AVALIACAO", "Venda recebeu avaliação"],
    ],
  },
  {
    id: "ATENDIMENTO",
    label: "Atendimento",
    description: "O que espera resposta do vendedor",
    events: [
      ["PERGUNTA", "Pergunta no anúncio"],
      ["MENSAGEM", "Mensagem do comprador"],
      ["RECLAMACAO", "Reclamação ou devolução"],
    ],
  },
  {
    id: "ANUNCIOS",
    label: "Anúncios",
    description: "Alterações feitas fora do ERP, no painel do Mercado Livre",
    events: [
      ["ANUNCIO", "Anúncio pausado, reativado, encerrado ou excluído"],
      ["PRECO", "Preço alterado no Mercado Livre"],
      ["ESTOQUE", "Anúncio esgotado ou reposto"],
      ["FAMILIA", "Ficha do produto ou catálogo"],
    ],
  },
] as const;

export const MERCADOLIVRE_NOTIFICATION_EVENT_VALUES = MERCADOLIVRE_NOTIFICATION_EVENT_GROUPS.flatMap(
  (group) => group.events.map(([id]) => id),
);

export type MercadoLivreNotificationEvent = (typeof MERCADOLIVRE_NOTIFICATION_EVENT_VALUES)[number];

/**
 * Anúncios ficam desligados por padrão: depois da supressão de eco e do filtro
 * de materialidade sobra pouca coisa ali, e quem cadastra muito produto não quer
 * ser interrompido pelo próprio catálogo.
 */
export const MERCADOLIVRE_NOTIFICATION_EVENT_DEFAULTS: MercadoLivreNotificationEvent[] = [
  "PEDIDO",
  "ENVIO",
  "AVALIACAO",
  "PERGUNTA",
  "MENSAGEM",
  "RECLAMACAO",
];

export function isMercadoLivreNotificationEvent(value: unknown): value is MercadoLivreNotificationEvent {
  return MERCADOLIVRE_NOTIFICATION_EVENT_VALUES.includes(value as MercadoLivreNotificationEvent);
}

/**
 * Traduz o tópico cru do webhook para o evento que o usuário liga e desliga.
 */
export function mercadoLivreNotificationEventForTopic(topic: string): MercadoLivreNotificationEvent | null {
  const normalized = normalizeMercadoLivreTopic(topic);
  if (normalized === "orders_v2" || normalized === "orders") return "PEDIDO";
  if (normalized === "shipments") return "ENVIO";
  if (normalized.includes("feedback")) return "AVALIACAO";
  if (normalized === "questions") return "PERGUNTA";
  if (normalized === "messages" || normalized === "messaging") return "MENSAGEM";
  if (normalized.includes("claim") || normalized.includes("reclama")) return "RECLAMACAO";
  if (normalized === "items") return "ANUNCIO";
  if (normalized === "items_prices" || normalized === "public_offers") return "PRECO";
  if (normalized === "stock-locations") return "ESTOQUE";
  if ((normalized === "user-products-families" || normalized === "user-products")) return "FAMILIA";
  return null;
}

/**
 * Um tópico que ainda não tem evento correspondente nunca é silenciado por
 * engano: sem essa regra, adicionar um processador novo faria os avisos dele
 * sumirem até alguém lembrar de atualizar o catálogo.
 */
export function isMercadoLivreNotificationEventEnabled(topic: string, selected: unknown) {
  const event = mercadoLivreNotificationEventForTopic(topic);
  if (!event) return true;
  const enabled = Array.isArray(selected)
    ? selected.filter(isMercadoLivreNotificationEvent)
    : MERCADOLIVRE_NOTIFICATION_EVENT_DEFAULTS;
  return enabled.includes(event);
}
