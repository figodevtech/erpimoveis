import type {
  ChatMessage,
  ChatPushStatus,
  ChatReaction,
  ChatReactionSummary,
  ChatUser,
  ConversationSummary,
  MessagePage,
} from "@/lib/chat/contracts";

export class ChatRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message?: string,
  ) {
    super(message || code);
  }

  get retryable() {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

async function chatFetch<T>(url: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(url, { cache: "no-store", ...init });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ChatRequestError(
        typeof body?.error === "string" ? body.error : "CHAT_REQUEST_FAILED",
        response.status,
        typeof body?.message === "string" ? body.message : undefined,
      );
    }
    return body as T;
  } catch (error) {
    if (error instanceof ChatRequestError || (error instanceof DOMException && error.name === "AbortError")) {
      throw error;
    }
    throw new ChatRequestError("CHAT_NETWORK_ERROR", 0, "Falha de rede.");
  }
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export function fetchChatUsers(q: string, signal?: AbortSignal) {
  return chatFetch<{ users: ChatUser[] }>(`/api/chat/users?q=${encodeURIComponent(q)}`, { signal });
}

export function fetchConversations(signal?: AbortSignal) {
  return chatFetch<{ conversations: ConversationSummary[] }>("/api/chat/conversations", { signal });
}

export function createDirectConversation(recipientId: string) {
  return chatFetch<{ conversation: ConversationSummary; created: boolean }>(
    "/api/chat/conversations/direct",
    jsonInit("POST", { recipientId }),
  );
}

export function fetchMessages(conversationId: string, cursor?: string | null, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: "30" });
  if (cursor) params.set("cursor", cursor);
  return chatFetch<MessagePage>(
    `/api/chat/conversations/${conversationId}/messages?${params.toString()}`,
    { signal },
  );
}

export function postMessage(
  conversationId: string,
  content: string,
  clientMessageId: string,
  replyToMessageId?: string | null,
) {
  return chatFetch<{ message: ChatMessage; created: boolean }>(
    `/api/chat/conversations/${conversationId}/messages`,
    jsonInit("POST", { content, clientMessageId, replyToMessageId: replyToMessageId ?? null }),
  );
}

/**
 * O audio vai como multipart. O mesmo `clientMessageId` de uma retentativa
 * sobrescreve o objeto e devolve a mesma mensagem, sem duplicar.
 */
export function postVoiceMessage(
  conversationId: string,
  input: {
    blob: Blob;
    clientMessageId: string;
    durationMs: number;
    replyToMessageId?: string | null;
  },
) {
  const form = new FormData();
  form.set("audio", input.blob, `${input.clientMessageId}.audio`);
  form.set("clientMessageId", input.clientMessageId);
  form.set("durationMs", String(Math.round(input.durationMs)));
  if (input.replyToMessageId) form.set("replyToMessageId", input.replyToMessageId);

  return chatFetch<{ message: ChatMessage; created: boolean }>(
    `/api/chat/conversations/${conversationId}/messages/voice`,
    { method: "POST", body: form },
  );
}

export function patchMessage(messageId: string, content: string) {
  return chatFetch<{
    messageId: string;
    conversationId: string;
    content: string;
    editedAt: string | null;
  }>(`/api/chat/messages/${messageId}`, jsonInit("PATCH", { content }));
}

export function deleteMessageForMe(messageId: string) {
  return chatFetch<{ messageId: string; conversationId: string | null }>(
    `/api/chat/messages/${messageId}/for-me`,
    jsonInit("DELETE"),
  );
}

export function deleteMessageForEveryone(messageId: string) {
  return chatFetch<{
    messageId: string;
    conversationId: string;
    deletedForEveryoneAt: string | null;
  }>(`/api/chat/messages/${messageId}/for-everyone`, jsonInit("DELETE"));
}

type ReactionResult = {
  messageId: string;
  conversationId: string | null;
  reactions: ChatReactionSummary[];
};

export function putMessageReaction(messageId: string, reaction: ChatReaction) {
  return chatFetch<ReactionResult>(
    `/api/chat/messages/${messageId}/reaction`,
    jsonInit("PUT", { reaction }),
  );
}

export function deleteMessageReaction(messageId: string) {
  return chatFetch<ReactionResult>(
    `/api/chat/messages/${messageId}/reaction`,
    jsonInit("DELETE"),
  );
}

export function fetchAudioUrl(messageId: string, signal?: AbortSignal) {
  return chatFetch<{
    url: string;
    expiresAt: string;
    mimeType: string | null;
    durationMs: number;
  }>(`/api/chat/audio/${messageId}`, { signal });
}

export function markRead(conversationId: string, lastMessageId: string) {
  return chatFetch<{
    lastReadMessageId: string | null;
    lastReadAt: string | null;
    changed: boolean;
    conversationUnreadCount: number;
    unreadCount: number;
  }>(`/api/chat/conversations/${conversationId}/read`, jsonInit("POST", { lastMessageId }));
}

export function markConversationFocus(conversationId: string, active: boolean) {
  return chatFetch<{ ok: true }>(
    `/api/chat/conversations/${conversationId}/focus`,
    jsonInit("POST", { active }),
  );
}

export function fetchUnreadCount(signal?: AbortSignal) {
  return chatFetch<{ unreadCount: number }>("/api/chat/unread-count", { signal });
}

export function fetchRealtimeToken(signal?: AbortSignal) {
  return chatFetch<{ token: string; expiresAt: string }>("/api/chat/realtime-token", { signal });
}

export function fetchPushStatus(signal?: AbortSignal) {
  return chatFetch<ChatPushStatus>("/api/chat/push/status", { signal });
}

export function postPushSubscription(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  deviceLabel?: string;
}) {
  return chatFetch<ChatPushStatus>("/api/chat/push/subscriptions", jsonInit("POST", input));
}

export function deletePushSubscription(endpoint: string) {
  return chatFetch<ChatPushStatus>(
    "/api/chat/push/subscriptions",
    jsonInit("DELETE", { endpoint }),
  );
}
