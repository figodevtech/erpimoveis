"use client";

import * as React from "react";
import { ArrowDown, Loader2 } from "lucide-react";

import type { ChatMessage } from "@/lib/chat/contracts";
import { Button } from "@/components/ui/button";
import { chatDateKey, chatDateLabel, preservedScrollTop } from "./chat-utils";
import { ChatMessageBubble } from "./chat-message-bubble";

export function ChatTimeline({
  messages,
  currentUserId,
  loadingInitial,
  loadingOlder,
  hasMore,
  firstUnreadMessageId,
  initialUnreadCount,
  onLoadOlder,
  onReachedLatest,
  onRetry,
}: {
  messages: ChatMessage[];
  currentUserId: string;
  loadingInitial: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  firstUnreadMessageId: string | null;
  initialUnreadCount: number;
  onLoadOlder: () => Promise<void>;
  onReachedLatest: (lastMessageId: string) => void;
  onRetry: (message: ChatMessage) => void;
}) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const initializedRef = React.useRef(false);
  const previousLastIdRef = React.useRef<string | null>(null);
  const nearBottomRef = React.useRef(true);
  const [newBelow, setNewBelow] = React.useState(false);

  const distanceFromBottom = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return Number.POSITIVE_INFINITY;
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  }, []);

  const reportLatestIfReached = React.useCallback(() => {
    const last = messages.at(-1);
    if (!last || document.visibilityState !== "visible") return;
    if (distanceFromBottom() <= 80) onReachedLatest(last.id);
  }, [distanceFromBottom, messages, onReachedLatest]);

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || loadingInitial || messages.length === 0) return;

    if (!initializedRef.current) {
      initializedRef.current = true;
      if (firstUnreadMessageId) {
        viewport.querySelector<HTMLElement>(`[data-message-id="${firstUnreadMessageId}"]`)?.scrollIntoView({ block: "start" });
      } else {
        viewport.scrollTop = viewport.scrollHeight;
      }
      reportLatestIfReached();
      previousLastIdRef.current = messages.at(-1)?.id ?? null;
      return;
    }

    const lastId = messages.at(-1)?.id ?? null;
    if (lastId && lastId !== previousLastIdRef.current) {
      if (nearBottomRef.current) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
        window.setTimeout(reportLatestIfReached, 180);
      } else {
        setNewBelow(true);
      }
    }
    previousLastIdRef.current = lastId;
  }, [distanceFromBottom, firstUnreadMessageId, loadingInitial, messages, reportLatestIfReached]);

  const handleScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    if (viewport.scrollTop < 80 && hasMore && !loadingOlder) {
      const previousHeight = viewport.scrollHeight;
      const previousTop = viewport.scrollTop;
      void onLoadOlder().then(() => {
        requestAnimationFrame(() => {
          if (viewportRef.current) {
            viewportRef.current.scrollTop = preservedScrollTop(
              previousTop,
              previousHeight,
              viewportRef.current.scrollHeight,
            );
          }
        });
      });
    }

    nearBottomRef.current = distanceFromBottom() <= 140;
    if (distanceFromBottom() <= 80) {
      setNewBelow(false);
      reportLatestIfReached();
    }
  };

  React.useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") reportLatestIfReached();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [reportLatestIfReached]);

  const jumpToLatest = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    setNewBelow(false);
    window.setTimeout(reportLatestIfReached, 180);
  };

  if (loadingInitial) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center" aria-label="Carregando mensagens">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={viewportRef}
        onScroll={handleScroll}
        className="absolute inset-0 overflow-y-auto overscroll-contain px-3 py-4"
        aria-live="polite"
        aria-label="Histórico da conversa"
      >
        {loadingOlder ? (
          <div className="flex justify-center pb-3"><Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Carregando mensagens anteriores" /></div>
        ) : null}
        {!hasMore && messages.length > 0 ? (
          <p className="pb-3 text-center text-[11px] text-muted-foreground">Início da conversa</p>
        ) : null}
        {messages.length === 0 ? (
          <div className="flex min-h-full items-center justify-center text-center text-sm text-muted-foreground">
            Envie a primeira mensagem desta conversa.
          </div>
        ) : null}

        <div className="space-y-2">
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const showDate = !previous || chatDateKey(previous.createdAt) !== chatDateKey(message.createdAt);
            const showUnread = message.id === firstUnreadMessageId && initialUnreadCount > 0;
            return (
              <React.Fragment key={message.id}>
                {showDate ? (
                  <div className="flex items-center gap-3 py-2" role="separator">
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-[11px] font-medium text-muted-foreground">{chatDateLabel(message.createdAt)}</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                ) : null}
                {showUnread ? (
                  <div className="flex items-center gap-2 py-2" role="separator" aria-label={`${initialUnreadCount} mensagens não lidas`}>
                    <span className="h-px flex-1 bg-primary/40" />
                    <span className="text-[11px] font-medium text-primary">
                      {initialUnreadCount} {initialUnreadCount === 1 ? "mensagem não lida" : "mensagens não lidas"}
                    </span>
                    <span className="h-px flex-1 bg-primary/40" />
                  </div>
                ) : null}
                <ChatMessageBubble message={message} own={message.senderId === currentUserId} onRetry={onRetry} />
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {newBelow ? (
        <Button
          type="button"
          size="sm"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-lg"
          onClick={jumpToLatest}
        >
          <ArrowDown aria-hidden="true" /> Novas mensagens
        </Button>
      ) : null}
    </div>
  );
}
