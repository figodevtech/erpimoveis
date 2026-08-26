import type { ChatMessage, ChatUser, ConversationSummary, MessagePage } from "@/lib/chat/contracts";

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

export function fetchChatUsers(q: string, signal?: AbortSignal) {
  return chatFetch<{ users: ChatUser[] }>(`/api/chat/users?q=${encodeURIComponent(q)}`, { signal });
}

export function fetchConversations(signal?: AbortSignal) {
  return chatFetch<{ conversations: ConversationSummary[] }>("/api/chat/conversations", { signal });
}

export function createDirectConversation(recipientId: string) {
  return chatFetch<{ conversation: ConversationSummary; created: boolean }>(
    "/api/chat/conversations/direct",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientId }),
    },
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

export function postMessage(conversationId: string, content: string, clientMessageId: string) {
  return chatFetch<{ message: ChatMessage; created: boolean }>(
    `/api/chat/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, clientMessageId }),
    },
  );
}

export function markRead(conversationId: string, lastMessageId: string) {
  return chatFetch<{
    lastReadMessageId: string | null;
    lastReadAt: string | null;
    changed: boolean;
    conversationUnreadCount: number;
    unreadCount: number;
  }>(`/api/chat/conversations/${conversationId}/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lastMessageId }),
  });
}

export function fetchUnreadCount(signal?: AbortSignal) {
  return chatFetch<{ unreadCount: number }>("/api/chat/unread-count", { signal });
}

export function fetchRealtimeToken(signal?: AbortSignal) {
  return chatFetch<{ token: string; expiresAt: string }>("/api/chat/realtime-token", { signal });
}

