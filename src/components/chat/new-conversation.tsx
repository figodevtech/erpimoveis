"use client";

import * as React from "react";
import { ArrowLeft, Loader2, RefreshCw, Search } from "lucide-react";

import type { ChatUser } from "@/lib/chat/contracts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { selectDirectChatUser } from "./chat-actions";
import { createDirectConversation, fetchChatUsers } from "./chat-api";
import { ChatPresenceIndicator } from "./chat-presence-indicator";
import { useChat } from "./chat-provider";
import { userInitials } from "./chat-utils";

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
      <div className="shrink-0 border-b px-4 pb-3 pt-4 pr-12">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" aria-label="Voltar para conversas" onClick={showInbox}>
            <ArrowLeft aria-hidden="true" />
          </Button>
          <div>
            <h2 className="font-semibold">Nova conversa</h2>
            <p className="text-xs text-muted-foreground">Selecione um usuário ativo</p>
          </div>
        </div>
        <label className="relative mt-3 block">
          <span className="sr-only">Buscar usuário</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar usuário"
            className="pl-9"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading ? (
          <div className="space-y-2 p-4" aria-label="Carregando usuários">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 py-2">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-1/3" /></div>
              </div>
            ))}
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadUsers(search)}>
              <RefreshCw aria-hidden="true" /> Tentar novamente
            </Button>
          </div>
        ) : null}

        {!loading && !error && users.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">Nenhum usuário encontrado.</p>
        ) : null}

        {!loading && users.map((user) => (
          <button
            type="button"
            key={user.id}
            disabled={Boolean(selectingId)}
            onClick={() => void selectUser(user)}
            className="flex min-h-16 w-full items-center gap-3 border-b px-4 py-3 text-left hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60"
          >
            <div className="relative">
              <Avatar className="size-10">
                {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
                <AvatarFallback>{userInitials(user.nome)}</AvatarFallback>
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
