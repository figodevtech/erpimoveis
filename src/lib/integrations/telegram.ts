import { createHash, timingSafeEqual } from "node:crypto";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_TIMEOUT_MS = 10_000;
const TELEGRAM_USERNAME_PATTERN = /^[a-z][a-z0-9_]{4,31}$/;

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

export type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
};

export type TelegramChat = {
  id: number;
  type: string;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    from?: TelegramUser;
    chat: TelegramChat;
  };
};

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly errorCode: number,
    readonly retryAfterSeconds: number | null,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }

  get isPermanent() {
    return this.errorCode >= 400 && this.errorCode < 500 && this.errorCode !== 429;
  }
}

function getBotToken() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN não configurado.");
  return token;
}

export function getTelegramEnvironment() {
  const botUsername = String(process.env.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "");
  const webhookSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  const appUrl = String(process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "").trim().replace(/\/$/, "");
  return {
    enabled: String(process.env.TELEGRAM_NOTIFICATIONS_ENABLED ?? "false").toLowerCase() === "true",
    configured: Boolean(String(process.env.TELEGRAM_BOT_TOKEN ?? "").trim() && botUsername),
    botUsername,
    webhookSecret,
    appUrl,
  };
}

async function callTelegram<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${getBotToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
    signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as TelegramResponse<T>;
  if (!response.ok || !payload.ok || payload.result === undefined) {
    throw new TelegramApiError(
      String(payload.description ?? `Telegram respondeu HTTP ${response.status}.`).slice(0, 500),
      Number(payload.error_code ?? response.status),
      payload.parameters?.retry_after ? Number(payload.parameters.retry_after) : null,
    );
  }
  return payload.result;
}

export function getTelegramBot() {
  return callTelegram<TelegramUser>("getMe");
}

export function configureTelegramWebhook(webhookUrl: string, secretToken: string) {
  return callTelegram<boolean>("setWebhook", {
    url: webhookUrl,
    secret_token: secretToken,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
}

export function getTelegramWebhookInfo() {
  return callTelegram<{
    url: string;
    pending_update_count: number;
    last_error_date?: number;
    last_error_message?: string;
  }>("getWebhookInfo");
}

export function sendTelegramMessage(params: {
  chatId: number;
  text: string;
  buttonUrl?: string;
  buttonLabel?: string;
}) {
  return callTelegram<{ message_id: number }>("sendMessage", {
    chat_id: params.chatId,
    text: params.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: params.buttonUrl
      ? { inline_keyboard: [[{ text: params.buttonLabel ?? "Abrir OS", url: params.buttonUrl }]] }
      : undefined,
  });
}

export function hashTelegramLinkToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeTelegramUsername(value: unknown) {
  const username = String(value ?? "").trim().replace(/^@+/, "").toLowerCase();
  return TELEGRAM_USERNAME_PATTERN.test(username) ? username : null;
}

export function safeSecretMatches(received: string | null, expected: string) {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function escapeTelegramHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
