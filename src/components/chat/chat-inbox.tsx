"use client";

import * as React from "react";
import { AlertCircle, MessageCirclePlus, MessagesSquare, RefreshCw, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatConversationItem } from "./chat-conversation-item";
import { useChat } from "./chat-provider";
import { filterConversations } from "./chat-utils";
import { ChatEmptyState, ChatSearchField, ChatStatusBanner } from "./chat-visuals";

function InboxSkeleton() {
  return (
    <div aria-label="Carregando conversas" className="space-y-2 px-3 py-3">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-2xl border border-transparent bg-card/45 px-3 py-3">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between gap-4"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-10" /></div>
            <Skeleton className="h-3 w-11/12" />
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
    realtimeBannerVisible,
    reconnectRealtime,
  } = useChat();
  const [search, setSearch] = React.useState("");
  const filtered = React.useMemo(() => filterConversations(conversations, search), [conversations, search]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="chat-header-surface shrink-0 border-b border-border/60 px-4 pb-3 pr-12">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Conversas</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Mensagens internas da equipe</p>
          </div>
          <Button type="button" size="sm" onClick={showNewConversation} className="rounded-xl shadow-sm shadow-primary/15 transition-transform active:scale-[0.97] motion-reduce:transform-none">
            <MessageCirclePlus aria-hidden="true" />
            <span className="hidden min-[360px]:inline">Nova conversa</span>
            <span className="min-[360px]:hidden">Nova</span>
          </Button>
        </div>

        <div className="mt-3">
          <ChatSearchField value={search} onChange={setSearch} label="Buscar conversas" placeholder="Buscar conversas" />
        </div>
      </div>

      <ChatStatusBanner
        visible={realtimeBannerVisible}
        action={realtimeStatus === "disconnected" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-lg px-2 text-[11px] font-semibold text-amber-900 hover:bg-amber-500/15 dark:text-amber-100"
            onClick={reconnectRealtime}
          >
            <RefreshCw aria-hidden="true" className="size-3.5" /> Tentar reconectar
          </Button>
        ) : null}
      >
        Tempo real indisponível. Os dados serão conferidos ao retomar a conexão.
      </ChatStatusBanner>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-1.5">
        {conversationsLoading && conversations.length === 0 ? <InboxSkeleton /> : null}

        {conversationsError && conversations.length === 0 ? (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"><AlertCircle className="size-5" aria-hidden="true" /></div>
            <p className="max-w-64 text-sm text-muted-foreground">{conversationsError}</p>
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void refreshConversations()}>
              <RefreshCw aria-hidden="true" /> Tentar novamente
            </Button>
          </div>
        ) : null}

        {!conversationsLoading && !conversationsError && conversations.length === 0 ? (
          <ChatEmptyState icon={MessagesSquare} title="Nenhuma conversa ainda" description="Inicie uma conversa com outro usuário do sistema." />
        ) : null}

        {conversations.length > 0 && filtered.length === 0 ? (
          <ChatEmptyState icon={SearchX} title="Nenhuma conversa encontrada" compact />
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
