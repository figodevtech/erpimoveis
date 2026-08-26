"use client";

import * as React from "react";
import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";

import type { ChatMessage } from "@/lib/chat/contracts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ChatRequestError, fetchMessages, markRead, postMessage } from "./chat-api";
import { ChatComposer } from "./chat-composer";
import { ChatPresenceIndicator } from "./chat-presence-indicator";
import { useChat } from "./chat-provider";
import { ChatTimeline } from "./chat-timeline";
import { createOptimisticMessage, mergeChatMessages, userInitials } from "./chat-utils";
import { ChatStatusBanner } from "./chat-visuals";

export function ChatConversation() {
  const {
    currentUserId,
    selectedConversation,
    showInbox,
    isOnline,
    lastRealtimeEvent,
    refreshConversations,
    handleConversationRead,
    realtimeStatus,
  } = useChat();
  const conversationId = selectedConversation?.id ?? "";
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingInitial, setLoadingInitial] = React.useState(true);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [readError, setReadError] = React.useState<string | null>(null);
  const [firstUnreadMessageId, setFirstUnreadMessageId] = React.useState<string | null>(null);
  const [initialUnreadCount, setInitialUnreadCount] = React.useState(0);
  const [unreadRemaining, setUnreadRemaining] = React.useState(0);
  const [sendingCount, setSendingCount] = React.useState(0);
  const loadOlderRef = React.useRef(false);
  const readTimerRef = React.useRef<number | null>(null);
  const lastReadSentRef = React.useRef<string | null>(null);

  const loadInitial = React.useCallback(async (signal?: AbortSignal) => {
    if (!conversationId) return;
    setLoadingInitial(true);
    setLoadError(null);
    try {
      const page = await fetchMessages(conversationId, null, signal);
      setMessages((current) => mergeChatMessages(current.filter((message) => message.sendStatus !== "sent"), page.messages));
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setFirstUnreadMessageId(page.firstUnreadMessageId);
      setInitialUnreadCount(page.unreadCount);
      setUnreadRemaining(page.unreadCount);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLoadError("Não foi possível carregar as mensagens.");
    } finally {
      if (!signal?.aborted) setLoadingInitial(false);
    }
  }, [conversationId]);

  React.useEffect(() => {
    const controller = new AbortController();
    setMessages([]);
    setFirstUnreadMessageId(null);
    setInitialUnreadCount(0);
    setUnreadRemaining(0);
    lastReadSentRef.current = null;
    void loadInitial(controller.signal);
    return () => controller.abort();
  }, [loadInitial]);

  React.useEffect(() => {
    if (!lastRealtimeEvent || lastRealtimeEvent.event.conversationId !== conversationId) return;
    let active = true;
    void fetchMessages(conversationId).then((page) => {
      if (!active) return;
      setMessages((current) => mergeChatMessages(current, page.messages));
      setUnreadRemaining(page.unreadCount);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [conversationId, lastRealtimeEvent]);

  React.useEffect(() => () => {
    if (readTimerRef.current) window.clearTimeout(readTimerRef.current);
  }, []);

  const loadOlder = async () => {
    if (!conversationId || !nextCursor || !hasMore || loadOlderRef.current) return;
    loadOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await fetchMessages(conversationId, nextCursor);
      setMessages((current) => mergeChatMessages(page.messages, current));
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      setLoadError("Não foi possível carregar mensagens anteriores.");
    } finally {
      loadOlderRef.current = false;
      setLoadingOlder(false);
    }
  };

  const sendExisting = async (message: ChatMessage) => {
    setSendingCount((count) => count + 1);
    setMessages((items) => items.map((item) =>
      item.clientMessageId === message.clientMessageId
        ? { ...item, sendStatus: "sending", error: null }
        : item,
    ));
    try {
      const result = await postMessage(conversationId, message.content, message.clientMessageId);
      setMessages((items) => mergeChatMessages(items, [result.message]));
      void refreshConversations();
    } catch (error) {
      const requestError = error instanceof ChatRequestError ? error : new ChatRequestError("CHAT_NETWORK_ERROR", 0);
      setMessages((items) => items.map((item) =>
        item.clientMessageId === message.clientMessageId
          ? {
              ...item,
              sendStatus: "failed",
              retryable: requestError.retryable,
              error: requestError.retryable ? "Não foi possível enviar." : "A mensagem foi recusada.",
            }
          : item,
      ));
    } finally {
      setSendingCount((count) => Math.max(0, count - 1));
    }
  };

  const send = (content: string) => {
    const clientMessageId = crypto.randomUUID();
    const optimistic = createOptimisticMessage({
      conversationId,
      senderId: currentUserId,
      content,
      clientMessageId,
      createdAt: new Date().toISOString(),
    });
    setMessages((items) => mergeChatMessages(items, [optimistic]));
    void sendExisting(optimistic);
  };

  const reachedLatest = React.useCallback((reachedMessageId: string) => {
    if (unreadRemaining <= 0 || document.visibilityState !== "visible") return;
    const reachedIndex = messages.findIndex((message) => message.id === reachedMessageId);
    const readable = messages
      .slice(0, reachedIndex >= 0 ? reachedIndex + 1 : messages.length)
      .filter((message) => message.sendStatus === "sent")
      .at(-1);
    if (!readable || lastReadSentRef.current === readable.id) return;

    if (readTimerRef.current) window.clearTimeout(readTimerRef.current);
    readTimerRef.current = window.setTimeout(() => {
      lastReadSentRef.current = readable.id;
      setReadError(null);
      void markRead(conversationId, readable.id)
        .then((result) => {
          setUnreadRemaining(result.conversationUnreadCount);
          handleConversationRead(conversationId, result.conversationUnreadCount, result.unreadCount);
        })
        .catch(() => {
          lastReadSentRef.current = null;
          setReadError("Não foi possível registrar a leitura. Tentaremos novamente ao alcançar o fim.");
        });
    }, 300);
  }, [conversationId, handleConversationRead, messages, unreadRemaining]);

  if (!selectedConversation) return null;
  const participant = selectedConversation.participant;
  const participantOnline = isOnline(participant.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="chat-header-surface flex min-h-16 shrink-0 items-center gap-2 border-b border-border/60 px-3 pb-2 pr-12">
        <Button type="button" variant="ghost" size="icon" className="rounded-xl transition-transform active:scale-90 motion-reduce:transform-none" aria-label="Voltar para conversas" onClick={showInbox}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <Avatar className="size-10 ring-1 ring-border/70 ring-offset-2 ring-offset-transparent">
          {participant.avatarUrl ? <AvatarImage src={participant.avatarUrl} alt="" /> : null}
          <AvatarFallback className="bg-primary/10 font-semibold text-primary">{userInitials(participant.nome)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold tracking-tight">{participant.nome}</h2>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <ChatPresenceIndicator online={participantOnline} />
            <span aria-hidden="true">{participantOnline ? "Online" : "Offline"}</span>
            {participant.setor ? <><span aria-hidden="true">·</span><span className="truncate">{participant.setor.nome}</span></> : null}
          </div>
        </div>
      </div>

      <ChatStatusBanner visible={realtimeStatus === "disconnected" || realtimeStatus === "unavailable"}>
        Conexão em tempo real interrompida. As mensagens carregadas foram preservadas.
      </ChatStatusBanner>

      {loadError && messages.length === 0 ? (
        <div role="alert" className="chat-timeline-surface flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"><AlertCircle className="size-5" aria-hidden="true" /></div>
          <p className="max-w-64 text-sm text-muted-foreground">{loadError}</p>
          <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void loadInitial()}>
            <RefreshCw aria-hidden="true" /> Tentar novamente
          </Button>
        </div>
      ) : (
        <ChatTimeline
          messages={messages}
          currentUserId={currentUserId}
          loadingInitial={loadingInitial}
          loadingOlder={loadingOlder}
          hasMore={hasMore}
          firstUnreadMessageId={firstUnreadMessageId}
          initialUnreadCount={initialUnreadCount}
          participantName={participant.nome}
          onLoadOlder={loadOlder}
          onReachedLatest={reachedLatest}
          onRetry={(message) => void sendExisting(message)}
        />
      )}

      {readError ? <p role="alert" className="shrink-0 border-t border-destructive/10 bg-destructive/[0.06] px-3 py-1.5 text-center text-[11px] text-destructive">{readError}</p> : null}
      <ChatComposer onSend={send} sending={sendingCount > 0} />
    </div>
  );
}
