import { z } from "zod";

export const CHAT_MESSAGE_MAX_LENGTH = 5_000;
export const CHAT_MESSAGE_PAGE_SIZE = 30;
export const CHAT_MESSAGE_MAX_PAGE_SIZE = 100;

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
  } | null;
  unreadCount: number;
  lastMessageAt: string | null;
  lastReadMessageId: string | null;
};

export type MessageSendStatus = "sending" | "sent" | "failed";

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  clientMessageId: string;
  createdAt: string;
  unread?: boolean;
  sendStatus: MessageSendStatus;
  retryable?: boolean;
  error?: string | null;
};

export type MessagePage = {
  messages: ChatMessage[];
  nextCursor: string | null;
  hasMore: boolean;
  unreadCount: number;
  firstUnreadMessageId: string | null;
};

export type ChatRealtimeEvent = {
  kind: "conversation" | "message" | "read";
  conversationId: string;
  messageId?: string;
  senderId?: string;
  clientMessageId?: string;
  readerId?: string;
  lastReadMessageId?: string;
};

export const chatUserQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
});

export const directConversationSchema = z.object({
  recipientId: z.string().uuid(),
});

export const messageCreateSchema = z.object({
  content: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1, "CHAT_EMPTY_MESSAGE").max(CHAT_MESSAGE_MAX_LENGTH, "CHAT_MESSAGE_TOO_LONG")),
  clientMessageId: z.string().uuid(),
});

export const messageListQuerySchema = z.object({
  cursor: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(CHAT_MESSAGE_MAX_PAGE_SIZE).default(CHAT_MESSAGE_PAGE_SIZE),
});

export const markReadSchema = z.object({
  lastMessageId: z.string().uuid(),
});

export const conversationIdSchema = z.string().uuid();

