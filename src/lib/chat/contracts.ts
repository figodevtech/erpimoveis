import { z } from "zod";

export const CHAT_MESSAGE_MAX_LENGTH = 5_000;
export const CHAT_MESSAGE_PAGE_SIZE = 30;
export const CHAT_MESSAGE_MAX_PAGE_SIZE = 100;

/**
 * Janela unica de alteracao da fase 2. Edicao e exclusao para todos usam o
 * mesmo prazo; o valor viaja ate o SQL, que e quem realmente decide.
 */
export const CHAT_MESSAGE_EDIT_WINDOW_SECONDS = 15 * 60;
export const CHAT_MESSAGE_DELETE_WINDOW_SECONDS = CHAT_MESSAGE_EDIT_WINDOW_SECONDS;

/** Limites da mensagem de voz, replicados como constraint no banco. */
export const CHAT_VOICE_MAX_DURATION_MS = 5 * 60 * 1_000;
export const CHAT_VOICE_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_VOICE_MIME_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/aac",
] as const;
export const CHAT_AUDIO_BUCKET = "chat_audio";
/** URL assinada curta; o player pede outra quando esta perto de expirar. */
export const CHAT_AUDIO_URL_TTL_SECONDS = 300;

/** Recorte historico guardado junto da resposta citada. */
export const CHAT_REPLY_SNAPSHOT_MAX_LENGTH = 160;

/**
 * Foco confirmado pelo destinatario. O cliente reafirma antes de expirar; o
 * push so e suprimido enquanto a janela estiver valida.
 */
export const CHAT_FOCUS_TTL_SECONDS = 60;
export const CHAT_FOCUS_PING_INTERVAL_MS = 25_000;

export const CHAT_PUSH_MAX_DEVICES = 20;
export const CHAT_PUSH_PREVIEW_LENGTH = 140;

export const CHAT_REACTIONS = ["CORACAO", "LEGAL", "FELIZ", "TRISTE"] as const;
export type ChatReaction = (typeof CHAT_REACTIONS)[number];

export const CHAT_REACTION_LABELS: Record<ChatReaction, { emoji: string; nome: string }> = {
  CORACAO: { emoji: "❤️", nome: "coração" },
  LEGAL: { emoji: "👍", nome: "legal" },
  FELIZ: { emoji: "😄", nome: "feliz" },
  TRISTE: { emoji: "😢", nome: "triste" },
};

export type ChatMessageType = "TEXT" | "VOICE";

export type ChatUser = {
  id: string;
  nome: string;
  username: string | null;
  setor: { id: number; nome: string } | null;
  avatarUrl: string | null;
  online: boolean;
  lastSeenAt: string | null;
};

export type ConversationSummary = {
  id: string;
  participant: ChatUser;
  lastMessage: {
    id: string;
    content: string;
    senderId: string;
    createdAt: string;
    type: ChatMessageType;
    deleted: boolean;
  } | null;
  unreadCount: number;
  lastMessageAt: string | null;
  lastReadMessageId: string | null;
};

export type MessageSendStatus = "sending" | "sent" | "failed";

export type ChatReactionSummary = {
  reaction: ChatReaction;
  total: number;
  own: boolean;
};

export type ChatMessageReply = {
  /** Pode ser `null` quando a mensagem citada foi removida fisicamente. */
  messageId: string | null;
  type: ChatMessageType;
  content: string;
  senderName: string;
};

export type ChatMessageAudio = {
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  type: ChatMessageType;
  content: string;
  clientMessageId: string;
  createdAt: string;
  editedAt: string | null;
  deletedForEveryoneAt: string | null;
  reply: ChatMessageReply | null;
  audio: ChatMessageAudio | null;
  reactions: ChatReactionSummary[];
  unread?: boolean;
  sendStatus: MessageSendStatus;
  retryable?: boolean;
  error?: string | null;
  /** Blob local da gravacao, usado enquanto o envio nao foi confirmado. */
  localAudioUrl?: string | null;
};

export type MessagePage = {
  messages: ChatMessage[];
  nextCursor: string | null;
  hasMore: boolean;
  unreadCount: number;
  firstUnreadMessageId: string | null;
};

export type ChatRealtimeEvent = {
  kind: "conversation" | "message" | "read" | "message-updated" | "reaction";
  conversationId: string;
  messageId?: string;
  senderId?: string;
  clientMessageId?: string;
  messageType?: ChatMessageType;
  readerId?: string;
  lastReadMessageId?: string;
};

export type ChatPushStatus = {
  supported: boolean;
  vapidPublicKey: string | null;
  deviceCount: number;
};

export const chatUserQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
});

export const directConversationSchema = z.object({
  recipientId: z.string().uuid(),
});

const replyToMessageIdSchema = z.string().uuid().nullish();

export const messageCreateSchema = z.object({
  content: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1, "CHAT_EMPTY_MESSAGE").max(CHAT_MESSAGE_MAX_LENGTH, "CHAT_MESSAGE_TOO_LONG")),
  clientMessageId: z.string().uuid(),
  replyToMessageId: replyToMessageIdSchema,
});

export const messageEditSchema = z.object({
  content: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1, "CHAT_EMPTY_MESSAGE").max(CHAT_MESSAGE_MAX_LENGTH, "CHAT_MESSAGE_TOO_LONG")),
});

export const messageReactionSchema = z.object({
  reaction: z.enum(CHAT_REACTIONS, { error: "CHAT_INVALID_REACTION" }),
});

export const voiceMessageSchema = z.object({
  clientMessageId: z.string().uuid(),
  durationMs: z.coerce
    .number()
    .int()
    .min(1, "CHAT_INVALID_AUDIO")
    .max(CHAT_VOICE_MAX_DURATION_MS, "CHAT_AUDIO_TOO_LONG"),
  replyToMessageId: replyToMessageIdSchema,
});

export const messageListQuerySchema = z.object({
  cursor: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(CHAT_MESSAGE_MAX_PAGE_SIZE).default(CHAT_MESSAGE_PAGE_SIZE),
});

export const markReadSchema = z.object({
  lastMessageId: z.string().uuid(),
});

export const conversationFocusSchema = z.object({
  active: z.boolean(),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(1_000),
  keys: z.object({
    p256dh: z.string().min(1).max(300),
    auth: z.string().min(1).max(300),
  }),
  deviceLabel: z.string().trim().max(80).optional(),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(1_000),
});

export const conversationIdSchema = z.string().uuid();
export const messageIdSchema = z.string().uuid();

/** Rotulo curto usado na prévia da inbox, na citação e no corpo do push. */
export function chatMessagePreviewLabel(message: {
  type: ChatMessageType;
  content: string;
  deleted?: boolean;
}) {
  if (message.deleted) return "Mensagem excluída";
  if (message.type === "VOICE") return "Mensagem de voz";
  return message.content;
}

/** Extensão do arquivo de voz derivada do MIME aceito, nunca do nome enviado. */
export function chatAudioExtension(mimeType: string) {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/mp4") return "m4a";
  if (base === "audio/mpeg") return "mp3";
  if (base === "audio/aac") return "aac";
  return "webm";
}

export function isSupportedChatAudioMime(mimeType: string) {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (CHAT_VOICE_MIME_TYPES as readonly string[]).includes(base);
}
