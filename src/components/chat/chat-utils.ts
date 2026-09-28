import type {
  ChatMessage,
  ChatMessageAudio,
  ChatMessageReply,
  ChatMessageType,
  ChatReaction,
  ChatReactionSummary,
  ChatRealtimeEvent,
  ConversationSummary,
} from "@/lib/chat/contracts";
import {
  CHAT_MESSAGE_DELETE_WINDOW_SECONDS,
  CHAT_MESSAGE_EDIT_WINDOW_SECONDS,
  CHAT_REPLY_SNAPSHOT_MAX_LENGTH,
  chatMessagePreviewLabel,
} from "@/lib/chat/contracts";

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
  type = "TEXT",
  reply = null,
  audio = null,
  localAudioUrl = null,
}: {
  conversationId: string;
  senderId: string;
  content: string;
  clientMessageId: string;
  createdAt?: string;
  type?: ChatMessageType;
  reply?: ChatMessageReply | null;
  audio?: ChatMessageAudio | null;
  localAudioUrl?: string | null;
}): ChatMessage {
  return {
    id: `optimistic:${clientMessageId}`,
    conversationId,
    senderId,
    type,
    content,
    clientMessageId,
    createdAt,
    editedAt: null,
    deletedForEveryoneAt: null,
    reply,
    audio,
    reactions: [],
    localAudioUrl,
    sendStatus: "sending",
    retryable: true,
  };
}

/**
 * Recorte historico exibido na previa do composer e dentro do balao. Ele e
 * calculado a partir do conteudo atual no momento da resposta; o servidor
 * grava a sua propria copia e e ela que sobrevive a edicoes posteriores.
 */
export function chatReplyPreviewFrom(
  message: Pick<ChatMessage, "id" | "type" | "content" | "deletedForEveryoneAt">,
  senderName: string,
): ChatMessageReply {
  return {
    messageId: message.id,
    type: message.type,
    content: message.type === "VOICE" || message.deletedForEveryoneAt
      ? ""
      : message.content.replace(/\s+/g, " ").slice(0, CHAT_REPLY_SNAPSHOT_MAX_LENGTH),
    senderName,
  };
}

/** Texto curto de uma mensagem em listas, citacoes e avisos. */
export function chatMessageSummaryText(message: {
  type: ChatMessageType;
  content: string;
  deleted?: boolean;
}) {
  return chatMessagePreviewLabel(message);
}

export function chatAudioDurationLabel(durationMs: number) {
  const total = Math.max(0, Math.round(durationMs / 1_000));
  const minutos = Math.floor(total / 60);
  const segundos = total % 60;
  return `${minutos}:${String(segundos).padStart(2, "0")}`;
}

/**
 * Espelha as regras do SQL para nao oferecer acoes que o servidor recusaria.
 * O servidor continua sendo a autoridade: aqui so decidimos o que aparece.
 */
export function canEditChatMessage(
  message: ChatMessage,
  currentUserId: string,
  now = Date.now(),
) {
  return (
    message.senderId === currentUserId
    && message.type === "TEXT"
    && message.sendStatus === "sent"
    && !message.deletedForEveryoneAt
    && withinWindow(message.createdAt, CHAT_MESSAGE_EDIT_WINDOW_SECONDS, now)
  );
}

export function canDeleteChatMessageForEveryone(
  message: ChatMessage,
  currentUserId: string,
  now = Date.now(),
) {
  return (
    message.senderId === currentUserId
    && message.sendStatus === "sent"
    && !message.deletedForEveryoneAt
    && withinWindow(message.createdAt, CHAT_MESSAGE_DELETE_WINDOW_SECONDS, now)
  );
}

function withinWindow(createdAt: string, windowSeconds: number, now: number) {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  return now - created <= windowSeconds * 1_000;
}

/** Aplica ao estado local o resultado autorizado de uma reacao. */
export function applyMessageReactions(
  messages: ChatMessage[],
  messageId: string,
  reactions: ChatReactionSummary[],
) {
  return messages.map((message) =>
    message.id === messageId ? { ...message, reactions } : message,
  );
}

export function applyMessageEdit(
  messages: ChatMessage[],
  messageId: string,
  content: string,
  editedAt: string | null,
) {
  return messages.map((message) =>
    message.id === messageId ? { ...message, content, editedAt } : message,
  );
}

export function applyMessageDeletedForEveryone(
  messages: ChatMessage[],
  messageId: string,
  deletedForEveryoneAt: string,
) {
  return messages.map((message) =>
    message.id === messageId
      ? {
          ...message,
          content: "",
          editedAt: null,
          reactions: [],
          audio: null,
          reply: null,
          localAudioUrl: null,
          deletedForEveryoneAt,
        }
      : message,
  );
}

export function removeMessageLocally(messages: ChatMessage[], messageId: string) {
  return messages.filter((message) => message.id !== messageId);
}

/**
 * Reacao otimista: substitui a anterior, remove ao repetir a mesma e mantem os
 * totais coerentes ate a confirmacao do servidor.
 */
export function toggleReactionLocally(
  reactions: ChatReactionSummary[],
  reaction: ChatReaction,
): ChatReactionSummary[] {
  const anterior = reactions.find((item) => item.own);
  const removendo = anterior?.reaction === reaction;

  const ajustado = reactions
    .map((item) => {
      if (anterior && item.reaction === anterior.reaction) {
        return { ...item, total: item.total - 1, own: false };
      }
      return item;
    })
    .map((item) =>
      !removendo && item.reaction === reaction
        ? { ...item, total: item.total + 1, own: true }
        : item,
    )
    .filter((item) => item.total > 0);

  if (removendo) return ajustado;
  if (ajustado.some((item) => item.reaction === reaction)) return ajustado;
  return [...ajustado, { reaction, total: 1, own: true }];
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

/**
 * Um toque curto em área neutra revela os controles no touch. Mouse, controles
 * internos, troca de mensagem e deslocamento de scroll nunca selecionam.
 */
export function shouldRevealChatMessageControls({
  pointerType,
  startMessageKey,
  endMessageKey,
  deltaX,
  deltaY,
  interactive,
}: {
  pointerType: string;
  startMessageKey: string | null;
  endMessageKey: string | null;
  deltaX: number;
  deltaY: number;
  interactive: boolean;
}) {
  if (pointerType === "mouse" || interactive) return false;
  if (!startMessageKey || startMessageKey !== endMessageKey) return false;
  return Math.hypot(deltaX, deltaY) <= 10;
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

/**
 * Se o evento do Realtime pode mudar o contador de nao lidas de quem o recebe.
 * O broadcast vai para todos os participantes: reacao, mensagem que eu mesmo
 * mandei e leitura feita pela outra pessoa nao mudam as minhas nao lidas, e cada
 * uma custava uma chamada a `chat_unread_count`.
 */
export function eventChangesUnread(event: ChatRealtimeEvent, currentUserId: string) {
  if (event.kind === "reaction") return false;
  if (event.kind === "message" && event.senderId && event.senderId === currentUserId) return false;
  if (event.kind === "read" && event.readerId && event.readerId !== currentUserId) return false;
  return true;
}
