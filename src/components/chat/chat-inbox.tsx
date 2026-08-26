"use client";

import * as React from "react";
import { MessageCirclePlus, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatConversationItem } from "./chat-conversation-item";
import { useChat } from "./chat-provider";
import { filterConversations } from "./chat-utils";

function InboxSkeleton() {
  return (
    <div aria-label="Carregando conversas" className="space-y-1 px-4 py-3">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 py-3">
          <Skeleton className="size-11 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatInbox() {
  const {
    currentUserId,
    conversations,
    conversationsLoading,
    conversationsError,
    refreshConversations,
    showConversation,
    showNewConversation,
    isOnline,
    realtimeStatus,
  } = useChat();
  const [search, setSearch] = React.useState("");
  const filtered = React.useMemo(() => filterConversations(conversations, search), [conversations, search]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b px-4 pb-3 pt-4 pr-12">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Conversas</h2>
            <p className="text-xs text-muted-foreground">Mensagens internas da equipe</p>
          </div>
          <Button type="button" size="sm" onClick={showNewConversation}>
            <MessageCirclePlus aria-hidden="true" />
            <span className="hidden min-[360px]:inline">Nova conversa</span>
            <span className="min-[360px]:hidden">Nova</span>
          </Button>
        </div>

        <label className="relative mt-3 block">
          <span className="sr-only">Buscar conversas</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar conversas"
            className="pl-9"
          />
        </label>
        {realtimeStatus === "disconnected" || realtimeStatus === "unavailable" ? (
          <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            Tempo real indisponível. Os dados serão conferidos ao retomar a conexão.
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {conversationsLoading && conversations.length === 0 ? <InboxSkeleton /> : null}

        {conversationsError && conversations.length === 0 ? (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-muted-foreground">{conversationsError}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refreshConversations()}>
              <RefreshCw aria-hidden="true" /> Tentar novamente
            </Button>
          </div>
        ) : null}

        {!conversationsLoading && !conversationsError && conversations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <p className="font-medium">Nenhuma conversa ainda.</p>
            <p className="mt-1 text-sm text-muted-foreground">Inicie uma conversa com outro usuário do sistema.</p>
          </div>
        ) : null}

        {conversations.length > 0 && filtered.length === 0 ? (
          <div className="flex h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Nenhuma conversa encontrada.
          </div>
        ) : null}

        {filtered.map((conversation) => (
          <ChatConversationItem
            key={conversation.id}
            conversation={conversation}
            currentUserId={currentUserId}
            online={isOnline(conversation.participant.id)}
            onSelect={() => showConversation(conversation)}
          />
        ))}
      </div>
    </div>
  );
}

