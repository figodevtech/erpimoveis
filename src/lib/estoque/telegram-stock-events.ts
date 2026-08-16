export const STOCK_NOTIFICATION_EVENT_GROUPS = [
  {
    id: "ENTRADA",
    label: "Entradas",
    description: "Inclusões de saldo e seus cancelamentos",
    events: [
      ["ENTRADA_REGISTRO", "Entrada confirmada"],
      ["ENTRADA_ESTORNO", "Cancelamento de entrada"],
    ],
  },
  {
    id: "SAIDA_MANUAL",
    label: "Saídas avulsas",
    description: "Retiradas registradas diretamente no estoque",
    events: [
      ["SAIDA_MANUAL_REGISTRO", "Baixa avulsa"],
      ["SAIDA_MANUAL_ESTORNO", "Cancelamento da saída"],
    ],
  },
  {
    id: "VENDA",
    label: "Vendas",
    description: "Baixas e devoluções vinculadas a vendas",
    events: [
      ["VENDA_REGISTRO", "Baixa por venda"],
      ["VENDA_ESTORNO", "Estorno da venda"],
    ],
  },
  {
    id: "ORDEM_SERVICO",
    label: "Ordens de serviço",
    description: "Consumo e devolução de produtos de OS",
    events: [
      ["ORDEM_SERVICO_REGISTRO", "Baixa por OS"],
      ["ORDEM_SERVICO_ESTORNO", "Estorno da baixa da OS"],
    ],
  },
] as const;

export const STOCK_NOTIFICATION_EVENT_VALUES = STOCK_NOTIFICATION_EVENT_GROUPS.flatMap(
  (group) => group.events.map(([id]) => id),
);

export type StockNotificationEvent = (typeof STOCK_NOTIFICATION_EVENT_VALUES)[number];

export function isStockNotificationEvent(value: unknown): value is StockNotificationEvent {
  return STOCK_NOTIFICATION_EVENT_VALUES.includes(value as StockNotificationEvent);
}

export function classifyStockNotificationEvent(input: {
  origem: string;
  acao: string;
  sentido: string;
}): StockNotificationEvent | null {
  const origem = String(input.origem ?? "").toUpperCase();
  const acao = String(input.acao ?? "").toUpperCase();
  const sentido = String(input.sentido ?? "").toUpperCase();

  if (origem === "ENTRADA" && acao === "REGISTRO" && sentido === "ENTRADA") return "ENTRADA_REGISTRO";
  if (origem === "ENTRADA" && acao === "ESTORNO" && sentido === "SAIDA") return "ENTRADA_ESTORNO";
  if (origem === "SAIDA_MANUAL" && acao === "REGISTRO" && sentido === "SAIDA") return "SAIDA_MANUAL_REGISTRO";
  if (origem === "SAIDA_MANUAL" && acao === "ESTORNO" && sentido === "ENTRADA") return "SAIDA_MANUAL_ESTORNO";
  if (origem === "VENDA" && acao === "REGISTRO" && sentido === "SAIDA") return "VENDA_REGISTRO";
  if (origem === "VENDA" && acao === "ESTORNO" && sentido === "ENTRADA") return "VENDA_ESTORNO";
  if (origem === "ORDEM_SERVICO" && acao === "REGISTRO" && sentido === "SAIDA") return "ORDEM_SERVICO_REGISTRO";
  if (origem === "ORDEM_SERVICO" && acao === "ESTORNO" && sentido === "ENTRADA") return "ORDEM_SERVICO_ESTORNO";
  return null;
}
