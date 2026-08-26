import type { ChatMessage, ConversationSummary } from "@/lib/chat/contracts";

export function unreadBadgeLabel(count: number) {
  return count > 99 ? "99+" : String(Math.max(0, count));
}

export function userInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return `${words[0][0]}${words.length > 1 ? words.at(-1)?.[0] ?? "" : ""}`.toLocaleUpperCase("pt-BR");
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export function filterConversations(conversations: ConversationSummary[], search: string) {
  const term = normalize(search.trim());
  if (!term) return conversations;
  return conversations.filter((conversation) =>
    [conversation.participant.nome, conversation.participant.username, conversation.participant.setor?.nome]
      .filter(Boolean)
      .some((value) => normalize(String(value)).includes(term)),
  );
}

export function mergeChatMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const result = [...current];

  for (const message of incoming) {
    const index = result.findIndex(
      (candidate) =>
        candidate.id === message.id ||
        (candidate.senderId === message.senderId && candidate.clientMessageId === message.clientMessageId),
    );
    if (index >= 0) result[index] = { ...result[index], ...message };
    else result.push(message);
  }

  return result.sort((a, b) => {
    const time = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return time || a.id.localeCompare(b.id);
  });
}

export function chatMessageStableKey(message: Pick<ChatMessage, "senderId" | "clientMessageId">) {
  return `${message.senderId}:${message.clientMessageId}`;
}

export function appendedMessageKeys(
  previousKeys: string[],
  currentKeys: string[],
  animationReady: boolean,
) {
  if (!animationReady) return new Set<string>();
  if (previousKeys.length === 0) return new Set(currentKeys);

  const previousLastIndex = currentKeys.indexOf(previousKeys.at(-1) ?? "");
  if (previousLastIndex < 0) return new Set<string>();

  const previous = new Set(previousKeys);
  return new Set(currentKeys.slice(previousLastIndex + 1).filter((key) => !previous.has(key)));
}

export function createOptimisticMessage({
  conversationId,
  senderId,
  content,
  clientMessageId,
  createdAt = new Date().toISOString(),
}: {
  conversationId: string;
  senderId: string;
  content: string;
  clientMessageId: string;
  createdAt?: string;
}): ChatMessage {
  return {
    id: `optimistic:${clientMessageId}`,
    conversationId,
    senderId,
    content,
    clientMessageId,
    createdAt,
    sendStatus: "sending",
    retryable: true,
  };
}

export function applyConversationReadCounts(
  conversations: ConversationSummary[],
  conversationId: string,
  conversationUnread: number,
) {
  return conversations.map((conversation) =>
    conversation.id === conversationId
      ? { ...conversation, unreadCount: conversationUnread }
      : conversation,
  );
}

export function preservedScrollTop(
  previousTop: number,
  previousHeight: number,
  nextHeight: number,
) {
  return previousTop + nextHeight - previousHeight;
}

export function isTemporaryMessageError(status: number) {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

export function chatDateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function chatDateLabel(value: string, now = new Date()) {
  const date = new Date(value);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((today - target) / 86_400_000);
  if (days === 0) return "Hoje";
  if (days === 1) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

export function chatListTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  if (chatDateKey(value) === chatDateKey(now.toISOString())) {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date);
}

export type ChatRealtimeStatus = "connecting" | "connected" | "disconnected" | "unavailable";

const RECONEXAO_BASE_MS = 1_000;
const RECONEXAO_TETO_MS = 30_000;

/**
 * Espera antes da proxima tentativa de reconexao: 1s, 2s, 4s, 8s, 16s e 30s
 * dai em diante. O teto evita que uma queda longa deixe o chat parado por
 * minutos depois que a rede volta.
 */
export function nextReconnectDelay(attempt: number) {
  const expoente = Math.max(0, Math.trunc(attempt));
  if (expoente >= 31) return RECONEXAO_TETO_MS;
  return Math.min(RECONEXAO_TETO_MS, RECONEXAO_BASE_MS * 2 ** expoente);
}

/**
 * O aviso reflete apenas o canal de mensagens. A presenca e cosmetica: perde-la
 * deixa as bolinhas em offline, mas nao significa que mensagens pararam.
 */
export function shouldShowRealtimeBanner(status: ChatRealtimeStatus) {
  return status === "disconnected" || status === "unavailable";
}
