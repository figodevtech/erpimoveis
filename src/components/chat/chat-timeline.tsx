"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDown, Loader2, MessageCircle } from "lucide-react";

import type { ChatMessage } from "@/lib/chat/contracts";
import { Button } from "@/components/ui/button";
import {
  appendedMessageKeys,
  chatDateKey,
  chatDateLabel,
  chatMessageStableKey,
  preservedScrollTop,
  shouldRevealChatMessageControls,
} from "./chat-utils";
import type { ChatMessageBubbleActions } from "./chat-message-bubble";
import { ChatMessageBubble } from "./chat-message-bubble";

export function ChatTimeline({
  messages,
  currentUserId,
  loadingInitial,
  loadingOlder,
  hasMore,
  firstUnreadMessageId,
  initialUnreadCount,
  participantName,
  onLoadOlder,
  onReachedLatest,
  onRetry,
  actions,
  highlightedMessageId,
}: {
  messages: ChatMessage[];
  currentUserId: string;
  loadingInitial: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  firstUnreadMessageId: string | null;
  initialUnreadCount: number;
  participantName: string;
  onLoadOlder: () => Promise<void>;
  onReachedLatest: (lastMessageId: string) => void;
  onRetry: (message: ChatMessage) => void;
  actions?: ChatMessageBubbleActions;
  /** Mensagem alcancada por uma citacao; recebe destaque temporario. */
  highlightedMessageId?: string | null;
}) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const initializedRef = React.useRef(false);
  const previousLastIdRef = React.useRef<string | null>(null);
  const nearBottomRef = React.useRef(true);
  const pointerStartRef = React.useRef<{
    pointerType: string;
    messageKey: string;
    x: number;
    y: number;
  } | null>(null);
  const [newBelow, setNewBelow] = React.useState(false);
  const [selectedMessageKey, setSelectedMessageKey] = React.useState<string | null>(null);
  const [animationSnapshot, setAnimationSnapshot] = React.useState<{
    keys: string[];
    ready: boolean;
  }>({ keys: [], ready: false });
  const currentMessageKeys = React.useMemo(() => messages.map(chatMessageStableKey), [messages]);
  const enteringMessageKeys = appendedMessageKeys(
    animationSnapshot.keys,
    currentMessageKeys,
    animationSnapshot.ready && !loadingInitial,
  );

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
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
        window.setTimeout(reportLatestIfReached, 180);
      } else {
        setNewBelow(true);
      }
    }
    previousLastIdRef.current = lastId;
  }, [distanceFromBottom, firstUnreadMessageId, loadingInitial, messages, reduceMotion, reportLatestIfReached]);

  React.useEffect(() => {
    if (loadingInitial) return;
    setAnimationSnapshot((current) => {
      const sameKeys = current.keys.length === currentMessageKeys.length
        && current.keys.every((key, index) => key === currentMessageKeys[index]);
      if (sameKeys && current.ready) return current;
      return { keys: currentMessageKeys, ready: true };
    });
  }, [currentMessageKeys, loadingInitial]);

  React.useEffect(() => {
    setSelectedMessageKey((current) => (
      current && currentMessageKeys.includes(current) ? current : null
    ));
  }, [currentMessageKeys]);

  React.useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || !selectedMessageKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (viewportRef.current?.contains(target)) return;
      if (target.closest(
        "[data-slot='dropdown-menu-content'], [data-slot='popover-content'], [data-slot='alert-dialog-content']",
      )) return;
      setSelectedMessageKey(null);
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    return () => document.removeEventListener("pointerdown", dismissOutside, true);
  }, [selectedMessageKey]);

  const messageElementFrom = (target: EventTarget | null) => (
    target instanceof Element
      ? target.closest<HTMLElement>("[data-chat-message-key]")
      : null
  );

  const isInteractiveMessageTarget = (target: EventTarget | null) => Boolean(
    target instanceof Element
    && target.closest(
      "button, a, input, textarea, select, [role='button'], [data-chat-message-control='true']",
    ),
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;
    const messageElement = messageElementFrom(event.target);
    if (!messageElement) {
      pointerStartRef.current = null;
      setSelectedMessageKey(null);
      return;
    }
    if (isInteractiveMessageTarget(event.target)) {
      pointerStartRef.current = null;
      return;
    }
    const messageKey = messageElement.dataset.chatMessageKey;
    if (!messageKey) return;
    pointerStartRef.current = {
      pointerType: event.pointerType,
      messageKey,
      x: event.clientX,
      y: event.clientY,
    };
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start) return;
    const endMessageKey = messageElementFrom(event.target)?.dataset.chatMessageKey ?? null;
    if (shouldRevealChatMessageControls({
      pointerType: start.pointerType,
      startMessageKey: start.messageKey,
      endMessageKey,
      deltaX: event.clientX - start.x,
      deltaY: event.clientY - start.y,
      interactive: isInteractiveMessageTarget(event.target),
    })) {
      setSelectedMessageKey(start.messageKey);
    }
  };

  const handleScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    pointerStartRef.current = null;
    setSelectedMessageKey(null);

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

  // Clicar na citacao rola ate a mensagem original assim que ela existir na
  // lista; quem carrega as paginas anteriores e a conversa.
  React.useEffect(() => {
    if (!highlightedMessageId) return;
    const viewport = viewportRef.current;
    const alvo = viewport?.querySelector<HTMLElement>(`[data-message-id="${highlightedMessageId}"]`);
    if (!alvo) return;
    alvo.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  }, [highlightedMessageId, messages, reduceMotion]);

  const jumpToLatest = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
    setNewBelow(false);
    window.setTimeout(reportLatestIfReached, 180);
  };

  if (loadingInitial) {
    return (
      <div className="chat-timeline-surface flex min-h-0 flex-1 flex-col items-center justify-center gap-2" aria-label="Carregando mensagens">
        <div className="flex size-10 items-center justify-center rounded-2xl bg-card/80 text-primary shadow-sm ring-1 ring-border/60">
          <Loader2 className="size-5 animate-spin" />
        </div>
        <span className="text-xs text-muted-foreground">Carregando mensagens</span>
      </div>
    );
  }

  return (
    <div className="chat-timeline-surface relative min-h-0 flex-1">
      <div
        ref={viewportRef}
        onScroll={handleScroll}
        onPointerDownCapture={handlePointerDown}
        onPointerUpCapture={handlePointerUp}
        onPointerCancel={() => { pointerStartRef.current = null; }}
        className="absolute inset-0 overflow-y-auto overscroll-contain px-3 py-4"
        aria-live="polite"
        aria-label="Histórico da conversa"
        data-chat-touch-dismiss-surface="true"
      >
        {loadingOlder ? (
          <div className="flex justify-center pb-3"><span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/75 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Carregando anteriores</span></div>
        ) : null}
        {!hasMore && messages.length > 0 ? (
          <p className="pb-3 text-center text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/75">Início da conversa</p>
        ) : null}
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center px-8 text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/10"><MessageCircle className="size-5" aria-hidden="true" /></div>
            <p className="text-sm font-semibold text-foreground">Comece a conversa</p>
            <p className="mt-1 max-w-60 text-xs leading-relaxed text-muted-foreground">Envie a primeira mensagem para {participantName}.</p>
          </div>
        ) : null}

        <div className="space-y-2">
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const showDate = !previous || chatDateKey(previous.createdAt) !== chatDateKey(message.createdAt);
            const showUnread = message.id === firstUnreadMessageId && initialUnreadCount > 0;
            const stableKey = chatMessageStableKey(message);
            const animateEntry = enteringMessageKeys.has(stableKey) && !reduceMotion;
            return (
              <React.Fragment key={stableKey}>
                {showDate ? (
                  <div className="flex justify-center py-2.5" role="separator">
                    <span className="rounded-full border border-border/55 bg-card/70 px-2.5 py-1 text-[10px] font-medium text-muted-foreground shadow-xs backdrop-blur-sm">{chatDateLabel(message.createdAt)}</span>
                  </div>
                ) : null}
                {showUnread ? (
                  <div className="flex items-center gap-2 py-2" role="separator" aria-label={`${initialUnreadCount} mensagens não lidas`}>
                    <span className="h-px flex-1 bg-primary/25" />
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold text-primary">
                      {initialUnreadCount} {initialUnreadCount === 1 ? "mensagem não lida" : "mensagens não lidas"}
                    </span>
                    <span className="h-px flex-1 bg-primary/25" />
                  </div>
                ) : null}
                <motion.div
                  initial={animateEntry ? { opacity: 0, y: 8, scale: 0.985 } : false}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  <ChatMessageBubble
                    message={message}
                    own={message.senderId === currentUserId}
                    currentUserId={currentUserId}
                    onRetry={onRetry}
                    actions={actions}
                    highlighted={highlightedMessageId === message.id}
                    selected={selectedMessageKey === stableKey}
                    onInteractionOpenChange={(open) => {
                      setSelectedMessageKey((current) => (
                        open ? stableKey : current === stableKey ? null : current
                      ));
                    }}
                  />
                </motion.div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {newBelow ? (
          <motion.div
            initial={{ opacity: 0, y: reduceMotion ? 0 : 8, scale: reduceMotion ? 1 : 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : 6, scale: reduceMotion ? 1 : 0.96 }}
            transition={{ duration: reduceMotion ? 0.08 : 0.18, ease: "easeOut" }}
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2"
          >
            <Button
              type="button"
              size="sm"
              className="rounded-full border border-primary/15 bg-primary text-primary-foreground shadow-lg shadow-primary/20 backdrop-blur-sm transition-transform active:scale-[0.97] motion-reduce:transform-none"
              onClick={jumpToLatest}
            >
              <ArrowDown aria-hidden="true" /> Novas mensagens
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
