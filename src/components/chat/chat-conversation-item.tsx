"use client";

import type { ConversationSummary } from "@/lib/chat/contracts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChatPresenceIndicator } from "./chat-presence-indicator";
import { UnreadBadge } from "./unread-badge";
import { chatListTime, userInitials } from "./chat-utils";

export function ChatConversationItem({
  conversation,
  currentUserId,
  online,
  onSelect,
}: {
  conversation: ConversationSummary;
  currentUserId: string;
  online: boolean;
  onSelect: () => void;
}) {
  const participant = conversation.participant;
  const ownLastMessage = conversation.lastMessage?.senderId === currentUserId;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex min-h-20 w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <div className="relative shrink-0">
        <Avatar className="size-11">
          {participant.avatarUrl ? <AvatarImage src={participant.avatarUrl} alt="" /> : null}
          <AvatarFallback className="text-sm font-semibold">{userInitials(participant.nome)}</AvatarFallback>
        </Avatar>
        <ChatPresenceIndicator
          online={online}
          className="absolute -bottom-0.5 -right-0.5 [&>span:first-child]:size-3"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{participant.nome}</span>
          <time className="shrink-0 text-[11px] text-muted-foreground">
            {chatListTime(conversation.lastMessageAt)}
          </time>
        </div>
        {participant.setor ? (
          <p className="truncate text-xs text-muted-foreground">{participant.setor.nome}</p>
        ) : null}
        <div className="mt-1 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {conversation.lastMessage ? (
              <>{ownLastMessage ? <span className="font-medium">Você: </span> : null}{conversation.lastMessage.content}</>
            ) : (
              "Conversa iniciada"
            )}
          </p>
          <UnreadBadge count={conversation.unreadCount} />
        </div>
      </div>
    </button>
  );
}

