import { processTelegramStockNotifications } from "@/lib/estoque/telegram-stock-notifications";
import { processTelegramFinanceiroNotifications } from "@/lib/financeiro/telegram-financeiro-notifications";
import { processTelegramFiscalNotifications } from "@/lib/fiscal/telegram-fiscal-notifications";
import { getTelegramEnvironment } from "@/lib/integrations/telegram";
import { processTelegramMarketplaceNotifications } from "@/lib/integrations/telegram-marketplace-notifications";

type QueueResult = {
  skipped?: boolean;
  sent?: number;
  failed?: number;
  events?: number;
  deliveries?: number;
  processedDeliveries?: number;
  error?: string;
  [key: string]: unknown;
};

async function safelyProcess(name: string, process: () => Promise<QueueResult>): Promise<QueueResult> {
  try {
    return await process();
  } catch (error) {
    const message = error instanceof Error ? error.message : `Falha ao processar a fila ${name}.`;
    console.error(`[telegram-processar:${name}]`, error);
    return { skipped: false, sent: 0, failed: 1, processedDeliveries: 0, error: message };
  }
}

export async function processTelegramNotificationQueues() {
  const environment = getTelegramEnvironment();
  if (environment.enabled && !environment.configured) {
    throw new Error("Telegram não está configurado por completo.");
  }

  const estoque = await safelyProcess("estoque", () => processTelegramStockNotifications());
  const fiscal = await safelyProcess("fiscal", () => processTelegramFiscalNotifications());
  const marketplace = await safelyProcess("marketplace", () => processTelegramMarketplaceNotifications());
  const financeiro = await safelyProcess("financeiro", () => processTelegramFinanceiroNotifications());

  // Cada fila nova entrava em quatro somas espalhadas. A lista é a fonte única:
  // acrescentar uma fila aqui já a inclui em tudo que é totalizado abaixo.
  const queues = [estoque, fiscal, marketplace, financeiro];
  const errors = queues.map((queue) => queue.error).filter((error): error is string => Boolean(error));
  const total = (field: keyof QueueResult) =>
    queues.reduce((sum, queue) => sum + Number(queue[field] ?? 0), 0);

  return {
    skipped: queues.every((queue) => queue.skipped === true),
    events: 0,
    deliveries: 0,
    processedDeliveries: total("processedDeliveries"),
    sent: total("sent"),
    failed: total("failed"),
    errors,
    estoque,
    fiscal,
    marketplace,
    financeiro,
  };
}
