import { processTelegramStockNotifications } from "@/lib/estoque/telegram-stock-notifications";
import { processTelegramFiscalNotifications } from "@/lib/fiscal/telegram-fiscal-notifications";
import { getTelegramEnvironment } from "@/lib/integrations/telegram";
import { processTelegramNotifications as processTelegramOrderNotifications } from "@/lib/ordens/telegram-notifications";
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

  const os = await safelyProcess("os", () => processTelegramOrderNotifications());
  const estoque = await safelyProcess("estoque", () => processTelegramStockNotifications());
  const fiscal = await safelyProcess("fiscal", () => processTelegramFiscalNotifications());
  const marketplace = await safelyProcess("marketplace", () => processTelegramMarketplaceNotifications());
  const errors = [os.error, estoque.error, fiscal.error, marketplace.error].filter((error): error is string => Boolean(error));

  return {
    skipped: os.skipped === true && estoque.skipped === true && fiscal.skipped === true && marketplace.skipped === true,
    events: Number(os.events ?? 0),
    deliveries: Number(os.deliveries ?? 0),
    processedDeliveries:
      Number(os.processedDeliveries ?? 0)
      + Number(estoque.processedDeliveries ?? 0)
      + Number(fiscal.processedDeliveries ?? 0)
      + Number(marketplace.processedDeliveries ?? 0),
    sent: Number(os.sent ?? 0) + Number(estoque.sent ?? 0) + Number(fiscal.sent ?? 0) + Number(marketplace.sent ?? 0),
    failed: Number(os.failed ?? 0) + Number(estoque.failed ?? 0) + Number(fiscal.failed ?? 0) + Number(marketplace.failed ?? 0),
    errors,
    os,
    estoque,
    fiscal,
    marketplace,
  };
}
