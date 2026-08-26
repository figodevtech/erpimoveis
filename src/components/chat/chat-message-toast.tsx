"use client";

import * as React from "react";
import { MessageCircle, X } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ChatMessage, ChatRealtimeEvent, ConversationSummary } from "@/lib/chat/contracts";
import { toast } from "@/lib/toast";
import { userInitials } from "./chat-utils";

const CHAT_TOAST_PREVIEW_LENGTH = 600;

export function isIncomingMessageNotification(
  event: ChatRealtimeEvent,
  currentUserId: string,
) {
  return event.kind === "message"
    && Boolean(event.messageId)
    && Boolean(event.senderId)
    && event.senderId !== currentUserId;
}

export function chatToastPreview(content: string) {
  const normalized = content.trim().replace(/\s+/g, " ");
  if (normalized.length <= CHAT_TOAST_PREVIEW_LENGTH) return normalized;
  return `${normalized.slice(0, CHAT_TOAST_PREVIEW_LENGTH - 1).trimEnd()}…`;
}

export function ChatIncomingMessageToast({
  conversation,
  message,
  onDismiss,
}: {
  conversation: ConversationSummary;
  message: ChatMessage;
  onDismiss: () => void;
}) {
  const participant = conversation.participant;

  return (
    <div className="relative w-[min(390px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-sky-400/35 bg-gradient-to-br from-sky-600 to-blue-700 text-white shadow-2xl shadow-blue-950/25 ring-1 ring-white/10 dark:from-sky-700 dark:to-blue-900">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Fechar notificação"
        className="absolute right-2.5 top-2.5 flex size-7 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
      <div className="flex items-start gap-3 p-4 pr-9">
        <Avatar className="size-12 border border-white/25 bg-white/10 shadow-sm ring-2 ring-white/10">
          {participant.avatarUrl ? <AvatarImage src={participant.avatarUrl} alt="" /> : null}
          <AvatarFallback className="bg-white/15 text-sm font-bold text-white">
            {userInitials(participant.nome)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-100/85">
            <MessageCircle aria-hidden="true" className="size-3.5" />
            Nova mensagem
          </div>
          <p className="mt-1 truncate text-sm font-bold leading-tight">{participant.nome}</p>
          <p className="mt-0.5 truncate text-[11px] font-medium text-sky-100/80">
            {participant.setor?.nome ?? "Sem setor"}
          </p>
          <p className="mt-2 line-clamp-6 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/95 [overflow-wrap:anywhere]">
            {chatToastPreview(message.content)}
          </p>
        </div>
      </div>
    </div>
  );
}

export function showIncomingChatMessageToast(
  conversation: ConversationSummary,
  message: ChatMessage,
) {
  return toast.custom(
    (toastId) => (
      <ChatIncomingMessageToast
        conversation={conversation}
        message={message}
        onDismiss={() => toast.dismiss(toastId)}
      />
    ),
    {
      id: `chat-message:${message.id}`,
      position: "bottom-right",
      duration: 9_000,
      unstyled: true,
    },
  );
}

export function dismissIncomingChatMessageToast(messageId: string) {
  toast.dismiss(`chat-message:${messageId}`);
}
