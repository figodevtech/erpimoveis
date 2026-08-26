"use client";

import * as React from "react";
import { AlertCircle, ArrowLeft, Loader2, RefreshCw, SearchX } from "lucide-react";

import type { ChatUser } from "@/lib/chat/contracts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { selectDirectChatUser } from "./chat-actions";
import { createDirectConversation, fetchChatUsers } from "./chat-api";
import { ChatPresenceIndicator } from "./chat-presence-indicator";
import { useChat } from "./chat-provider";
import { userInitials } from "./chat-utils";
import { ChatEmptyState, ChatSearchField } from "./chat-visuals";

export function NewConversation() {
  const { showInbox, showConversation, refreshConversations, isOnline } = useChat();
  const [search, setSearch] = React.useState("");
  const [users, setUsers] = React.useState<ChatUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectingId, setSelectingId] = React.useState<string | null>(null);

  const loadUsers = React.useCallback((query: string, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    return fetchChatUsers(query, signal)
      .then((result) => setUsers(result.users))
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError("Não foi possível carregar os usuários.");
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadUsers(search, controller.signal), 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadUsers, search]);

  const selectUser = async (user: ChatUser) => {
    if (selectingId) return;
    setSelectingId(user.id);
    setError(null);
    try {
      await selectDirectChatUser(user, {
        createConversation: createDirectConversation,
        refreshConversations,
        showConversation,
      });
    } catch {
      setError("Não foi possível iniciar a conversa.");
    } finally {
      setSelectingId(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="chat-header-surface shrink-0 border-b border-border/60 px-4 pb-3 pr-12">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" className="rounded-xl transition-transform active:scale-90 motion-reduce:transform-none" aria-label="Voltar para conversas" onClick={showInbox}>
            <ArrowLeft aria-hidden="true" />
          </Button>
          <div>
            <h2 className="font-semibold tracking-tight">Nova conversa</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Selecione um usuário ativo</p>
          </div>
        </div>
        <div className="mt-3">
          <ChatSearchField autoFocus value={search} onChange={setSearch} label="Buscar usuário" placeholder="Buscar usuário" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-1.5">
        {loading ? (
          <div className="space-y-2 p-1.5" aria-label="Carregando usuários">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 rounded-2xl bg-card/45 px-3 py-3">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-1/3" /></div>
              </div>
            ))}
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"><AlertCircle className="size-5" aria-hidden="true" /></div>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void loadUsers(search)}>
              <RefreshCw aria-hidden="true" /> Tentar novamente
            </Button>
          </div>
        ) : null}

        {!loading && !error && users.length === 0 ? (
          <ChatEmptyState icon={SearchX} title="Nenhum usuário encontrado" compact />
        ) : null}

        {!loading && users.map((user) => (
          <button
            type="button"
            key={user.id}
            disabled={Boolean(selectingId)}
            onClick={() => void selectUser(user)}
            className="group flex min-h-16 w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-left transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-primary/10 hover:bg-card/80 hover:shadow-sm focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] disabled:opacity-60 motion-reduce:transform-none"
          >
            <div className="relative">
              <Avatar className="size-10 ring-1 ring-border/70 ring-offset-2 ring-offset-transparent transition-transform duration-200 group-hover:scale-[1.03] motion-reduce:transform-none">
                {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
                <AvatarFallback className="bg-primary/10 font-semibold text-primary">{userInitials(user.nome)}</AvatarFallback>
              </Avatar>
              <ChatPresenceIndicator online={isOnline(user.id)} className="absolute -bottom-0.5 -right-0.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.nome}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[user.username ? `@${user.username}` : null, user.setor?.nome].filter(Boolean).join(" · ") || "Sem setor"}
              </p>
            </div>
            {selectingId === user.id ? <Loader2 className="size-4 animate-spin" aria-label="Abrindo conversa" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
