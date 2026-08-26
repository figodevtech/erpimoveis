"use client";

import type { ConversationSummary } from "@/lib/chat/contracts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
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
      className={cn(
        "group flex min-h-20 w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-left transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-primary/10 hover:bg-card/80 hover:shadow-sm focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] motion-reduce:transform-none",
        conversation.unreadCount > 0 && "bg-primary/[0.075] hover:bg-primary/[0.1] dark:bg-primary/[0.11]",
      )}
    >
      <div className="relative shrink-0">
        <Avatar className="size-11 ring-1 ring-border/70 ring-offset-2 ring-offset-transparent transition-transform duration-200 group-hover:scale-[1.03] motion-reduce:transform-none">
          {participant.avatarUrl ? <AvatarImage src={participant.avatarUrl} alt="" /> : null}
          <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">{userInitials(participant.nome)}</AvatarFallback>
        </Avatar>
        <ChatPresenceIndicator
          online={online}
          className="absolute -bottom-0.5 -right-0.5 [&>span:first-child]:size-3"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", conversation.unreadCount > 0 ? "font-bold text-foreground" : "font-semibold")}>{participant.nome}</span>
          <time className="shrink-0 text-[11px] text-muted-foreground">
            {chatListTime(conversation.lastMessageAt)}
          </time>
        </div>
        {participant.setor ? (
          <p className="truncate text-xs text-muted-foreground">{participant.setor.nome}</p>
        ) : null}
        <div className="mt-1 flex items-center gap-2">
          <p className={cn("min-w-0 flex-1 truncate text-xs", conversation.unreadCount > 0 ? "font-medium text-foreground/80" : "text-muted-foreground")}>
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
