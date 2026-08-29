"use client";

import * as React from "react";
import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";

import type { ChatMessage, ChatReaction } from "@/lib/chat/contracts";
import { CHAT_FOCUS_PING_INTERVAL_MS } from "@/lib/chat/contracts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  ChatRequestError,
  deleteMessageForEveryone,
  deleteMessageForMe,
  deleteMessageReaction,
  fetchMessages,
  markConversationFocus,
  markRead,
  patchMessage,
  postMessage,
  postVoiceMessage,
  putMessageReaction,
} from "./chat-api";
import type { ChatComposerEditing, ChatComposerReply } from "./chat-composer";
import { ChatComposer } from "./chat-composer";
import type { ChatMessageBubbleActions } from "./chat-message-bubble";
import { ChatPresenceIndicator } from "./chat-presence-indicator";
import { useChat } from "./chat-provider";
import { ChatTimeline } from "./chat-timeline";
import {
  applyMessageDeletedForEveryone,
  applyMessageEdit,
  applyMessageReactions,
  chatReplyPreviewFrom,
  createOptimisticMessage,
  mergeChatMessages,
  removeMessageLocally,
  toggleReactionLocally,
  userInitials,
} from "./chat-utils";
import { ChatStatusBanner } from "./chat-visuals";

/** Quantas paginas anteriores buscamos ao seguir uma citacao antiga. */
const MAX_PAGINAS_PARA_CITACAO = 20;
const DESTAQUE_MS = 2_600;

type GravacaoPendente = {
  blob: Blob;
  durationMs: number;
  replyToMessageId: string | null;
};

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
    realtimeBannerVisible,
    reconnectRealtime,
    degradedPollTick,
    pendingMessageFocus,
    consumePendingMessageFocus,
  } = useChat();
  const conversationId = selectedConversation?.id ?? "";
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingInitial, setLoadingInitial] = React.useState(true);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [readError, setReadError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [firstUnreadMessageId, setFirstUnreadMessageId] = React.useState<string | null>(null);
  const [initialUnreadCount, setInitialUnreadCount] = React.useState(0);
  const [unreadRemaining, setUnreadRemaining] = React.useState(0);
  const [sendingCount, setSendingCount] = React.useState(0);
  const [voiceSending, setVoiceSending] = React.useState(false);
  const [reply, setReply] = React.useState<ChatComposerReply | null>(null);
  const [editing, setEditing] = React.useState<ChatComposerEditing | null>(null);
  const [editSaving, setEditSaving] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = React.useState<string | null>(null);

  const loadOlderRef = React.useRef(false);
  const readTimerRef = React.useRef<number | null>(null);
  const lastReadSentRef = React.useRef<string | null>(null);
  const messagesRef = React.useRef<ChatMessage[]>([]);
  const cursorRef = React.useRef<{ cursor: string | null; hasMore: boolean }>({ cursor: null, hasMore: false });
  const gravacoesRef = React.useRef(new Map<string, GravacaoPendente>());
  const blobUrlsRef = React.useRef<string[]>([]);

  messagesRef.current = messages;
  cursorRef.current = { cursor: nextCursor, hasMore };

  const participantName = selectedConversation?.participant.nome ?? "";

  const nomeDoAutor = React.useCallback(
    (message: ChatMessage) => (message.senderId === currentUserId ? "você" : participantName),
    [currentUserId, participantName],
  );

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
    setReply(null);
    setEditing(null);
    setActionError(null);
    lastReadSentRef.current = null;
    void loadInitial(controller.signal);
    return () => controller.abort();
  }, [loadInitial]);

  React.useEffect(() => {
    const urls = blobUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.length = 0;
    };
  }, [conversationId]);

  // Rele a pagina recente e concilia com o que ja esta na tela, preservando
  // mensagens otimistas e falhas. Serve ao evento Realtime e tambem ao modo
  // degradado, quando nao chega evento nenhum.
  const syncLatest = React.useCallback(() => {
    if (!conversationId) return undefined;
    let active = true;
    void fetchMessages(conversationId).then((page) => {
      if (!active) return;
      setMessages((current) => {
        const conciliadas = mergeChatMessages(current, page.messages);
        // Mensagens que o proprio usuario ocultou somem do servidor; a lista
        // local precisa acompanhar. A remocao vale somente dentro da janela que
        // esta pagina realmente cobre: fora dela estao as paginas antigas e as
        // mensagens persistidas depois deste retrato, que nao podem sumir.
        const idsDoServidor = new Set(page.messages.map((message) => message.id));
        const maisAntiga = page.messages[0]?.createdAt;
        const maisNova = page.messages.at(-1)?.createdAt;
        return conciliadas.filter((message) => {
          if (message.sendStatus !== "sent") return true;
          if (!maisAntiga || !maisNova) return true;
          if (message.createdAt < maisAntiga || message.createdAt > maisNova) return true;
          return idsDoServidor.has(message.id);
        });
      });
      setUnreadRemaining(page.unreadCount);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [conversationId]);

  React.useEffect(() => {
    if (!lastRealtimeEvent || lastRealtimeEvent.event.conversationId !== conversationId) return;
    return syncLatest();
  }, [conversationId, lastRealtimeEvent, syncLatest]);

  const lastPollTickRef = React.useRef(degradedPollTick);

  React.useEffect(() => {
    if (degradedPollTick === lastPollTickRef.current) return;
    lastPollTickRef.current = degradedPollTick;
    return syncLatest();
  }, [degradedPollTick, syncLatest]);

  React.useEffect(() => () => {
    if (readTimerRef.current) window.clearTimeout(readTimerRef.current);
  }, []);

  /**
   * Confirma ao servidor que esta conversa esta aberta, visivel e com Realtime
   * ativo. So nessa condicao o Web Push desta conversa e suprimido; a janela
   * expira sozinha se o cliente parar de reafirmar.
   */
  React.useEffect(() => {
    if (!conversationId || realtimeStatus !== "connected") return;

    let ativo = true;
    const enviar = (active: boolean) => {
      if (!ativo && active) return;
      void markConversationFocus(conversationId, active).catch(() => undefined);
    };
    const reafirmar = () => {
      if (document.visibilityState === "visible") enviar(true);
    };

    reafirmar();
    const timer = window.setInterval(reafirmar, CHAT_FOCUS_PING_INTERVAL_MS);
    document.addEventListener("visibilitychange", reafirmar);

    return () => {
      ativo = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", reafirmar);
      enviar(false);
    };
  }, [conversationId, realtimeStatus]);

  const loadOlder = React.useCallback(async () => {
    const { cursor, hasMore: aindaTem } = cursorRef.current;
    if (!conversationId || !cursor || !aindaTem || loadOlderRef.current) return false;
    loadOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await fetchMessages(conversationId, cursor);
      setMessages((current) => mergeChatMessages(page.messages, current));
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      cursorRef.current = { cursor: page.nextCursor, hasMore: page.hasMore };
      return true;
    } catch {
      setLoadError("Não foi possível carregar mensagens anteriores.");
      return false;
    } finally {
      loadOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [conversationId]);

  const destacar = React.useCallback((messageId: string) => {
    setHighlightedMessageId(messageId);
    window.setTimeout(() => {
      setHighlightedMessageId((atual) => (atual === messageId ? null : atual));
    }, DESTAQUE_MS);
  }, []);

  /** Segue a citacao: carrega paginas anteriores ate encontrar o original. */
  const jumpToMessage = React.useCallback(async (messageId: string) => {
    setActionError(null);
    const existe = () => messagesRef.current.some((message) => message.id === messageId);
    if (existe()) {
      destacar(messageId);
      return;
    }

    for (let tentativa = 0; tentativa < MAX_PAGINAS_PARA_CITACAO; tentativa += 1) {
      const carregou = await loadOlder();
      if (existe()) {
        destacar(messageId);
        return;
      }
      if (!carregou || !cursorRef.current.hasMore) break;
    }

    setActionError("A mensagem original não está mais disponível para você.");
  }, [destacar, loadOlder]);

  React.useEffect(() => {
    // Deep link do Web Push: abrir a conversa ja pedindo destaque na mensagem.
    if (!pendingMessageFocus || pendingMessageFocus.conversationId !== conversationId) return;
    if (loadingInitial) return;
    const messageId = pendingMessageFocus.messageId;
    consumePendingMessageFocus();
    if (messageId) void jumpToMessage(messageId);
  }, [conversationId, consumePendingMessageFocus, jumpToMessage, loadingInitial, pendingMessageFocus]);

  const marcarFalha = (clientMessageId: string, error: unknown, mensagemPadrao: string) => {
    const requestError = error instanceof ChatRequestError
      ? error
      : new ChatRequestError("CHAT_NETWORK_ERROR", 0);
    setMessages((items) => items.map((item) =>
      item.clientMessageId === clientMessageId
        ? {
            ...item,
            sendStatus: "failed",
            retryable: requestError.retryable,
            error: requestError.retryable ? mensagemPadrao : "A mensagem foi recusada.",
          }
        : item,
    ));
  };

  const sendExisting = async (message: ChatMessage) => {
    setSendingCount((count) => count + 1);
    setMessages((items) => items.map((item) =>
      item.clientMessageId === message.clientMessageId
        ? { ...item, sendStatus: "sending", error: null }
        : item,
    ));
    try {
      const result = await postMessage(
        conversationId,
        message.content,
        message.clientMessageId,
        message.reply?.messageId ?? null,
      );
      setMessages((items) => mergeChatMessages(items, [result.message]));
      void refreshConversations();
    } catch (error) {
      marcarFalha(message.clientMessageId, error, "Não foi possível enviar.");
    } finally {
      setSendingCount((count) => Math.max(0, count - 1));
    }
  };

  const sendVoiceExisting = async (message: ChatMessage) => {
    const gravacao = gravacoesRef.current.get(message.clientMessageId);
    if (!gravacao) {
      // A previa local nao sobrevive ao recarregamento da pagina.
      setMessages((items) => items.map((item) =>
        item.clientMessageId === message.clientMessageId
          ? {
              ...item,
              sendStatus: "failed",
              retryable: false,
              error: "A gravação foi perdida ao recarregar a página. Grave novamente.",
            }
          : item,
      ));
      return;
    }

    setVoiceSending(true);
    setSendingCount((count) => count + 1);
    setMessages((items) => items.map((item) =>
      item.clientMessageId === message.clientMessageId
        ? { ...item, sendStatus: "sending", error: null }
        : item,
    ));

    try {
      const result = await postVoiceMessage(conversationId, {
        blob: gravacao.blob,
        clientMessageId: message.clientMessageId,
        durationMs: gravacao.durationMs,
        replyToMessageId: gravacao.replyToMessageId,
      });
      setMessages((items) => mergeChatMessages(items, [result.message]));
      void refreshConversations();
    } catch (error) {
      marcarFalha(message.clientMessageId, error, "Não foi possível enviar o áudio.");
    } finally {
      setSendingCount((count) => Math.max(0, count - 1));
      setVoiceSending(false);
    }
  };

  const send = (content: string) => {
    const clientMessageId = crypto.randomUUID();
    const alvo = reply?.message ?? null;
    const optimistic = createOptimisticMessage({
      conversationId,
      senderId: currentUserId,
      content,
      clientMessageId,
      createdAt: new Date().toISOString(),
      reply: alvo ? chatReplyPreviewFrom(alvo, nomeDoAutor(alvo)) : null,
    });
    setReply(null);
    setMessages((items) => mergeChatMessages(items, [optimistic]));
    void sendExisting(optimistic);
  };

  const sendVoice = (blob: Blob, durationMs: number) => {
    const clientMessageId = crypto.randomUUID();
    const alvo = reply?.message ?? null;
    const localAudioUrl = URL.createObjectURL(blob);
    blobUrlsRef.current.push(localAudioUrl);
    gravacoesRef.current.set(clientMessageId, {
      blob,
      durationMs,
      replyToMessageId: alvo?.id ?? null,
    });

    const optimistic = createOptimisticMessage({
      conversationId,
      senderId: currentUserId,
      content: "",
      clientMessageId,
      createdAt: new Date().toISOString(),
      type: "VOICE",
      reply: alvo ? chatReplyPreviewFrom(alvo, nomeDoAutor(alvo)) : null,
      audio: { mimeType: blob.type || "audio/webm", sizeBytes: blob.size, durationMs },
      localAudioUrl,
    });

    setReply(null);
    setMessages((items) => mergeChatMessages(items, [optimistic]));
    void sendVoiceExisting(optimistic);
  };

  const retry = (message: ChatMessage) => {
    if (message.type === "VOICE") {
      void sendVoiceExisting(message);
      return;
    }
    void sendExisting(message);
  };

  const react = async (message: ChatMessage, reaction: ChatReaction) => {
    if (message.sendStatus !== "sent") return;
    const anterior = message.reactions;
    const otimista = toggleReactionLocally(anterior, reaction);
    const removendo = anterior.some((item) => item.own && item.reaction === reaction);

    setActionError(null);
    setMessages((items) => applyMessageReactions(items, message.id, otimista));

    try {
      const resultado = removendo
        ? await deleteMessageReaction(message.id)
        : await putMessageReaction(message.id, reaction);
      setMessages((items) => applyMessageReactions(items, message.id, resultado.reactions));
    } catch {
      setMessages((items) => applyMessageReactions(items, message.id, anterior));
      setActionError("Não foi possível registrar a reação.");
    }
  };

  const submitEdit = async (content: string) => {
    const alvo = editing?.message;
    if (!alvo) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const resultado = await patchMessage(alvo.id, content);
      setMessages((items) => applyMessageEdit(items, alvo.id, resultado.content, resultado.editedAt));
      setEditing(null);
    } catch (error) {
      const requestError = error instanceof ChatRequestError ? error : null;
      setEditError(
        requestError?.status === 409
          ? "O prazo para editar esta mensagem terminou."
          : "Não foi possível salvar a edição.",
      );
    } finally {
      setEditSaving(false);
    }
  };

  const deleteForMe = async (message: ChatMessage) => {
    setActionError(null);
    if (message.sendStatus !== "sent") {
      setMessages((items) => removeMessageLocally(items, message.id));
      return;
    }
    try {
      await deleteMessageForMe(message.id);
      setMessages((items) => removeMessageLocally(items, message.id));
      if (editing?.message.id === message.id) setEditing(null);
      if (reply?.message.id === message.id) setReply(null);
      void refreshConversations();
    } catch {
      setActionError("Não foi possível excluir a mensagem.");
    }
  };

  const deleteForEveryone = async (message: ChatMessage) => {
    setActionError(null);
    try {
      // Confirmacao do servidor antes de substituir o conteudo na tela.
      const resultado = await deleteMessageForEveryone(message.id);
      setMessages((items) => applyMessageDeletedForEveryone(
        items,
        message.id,
        resultado.deletedForEveryoneAt ?? new Date().toISOString(),
      ));
      if (editing?.message.id === message.id) setEditing(null);
      if (reply?.message.id === message.id) setReply(null);
      void refreshConversations();
    } catch (error) {
      const requestError = error instanceof ChatRequestError ? error : null;
      setActionError(
        requestError?.status === 409
          ? "O prazo para excluir esta mensagem para todos terminou."
          : "Não foi possível excluir a mensagem.",
      );
    }
  };

  // Recriado a cada render de proposito: as acoes leem `reply`, `editing` e
  // `messages` atuais por closure. Memorizar aqui congelaria esse estado, e a
  // animacao da timeline nao depende da identidade deste objeto.
  const bubbleActions: ChatMessageBubbleActions = {
    onReply: (message) => {
      setEditing(null);
      setReply({ message, authorName: nomeDoAutor(message) });
    },
    onReact: (message, reaction) => void react(message, reaction),
    onEdit: (message) => {
      setReply(null);
      setEditError(null);
      setEditing({ message });
    },
    onDeleteForMe: (message) => void deleteForMe(message),
    onDeleteForEveryone: (message) => void deleteForEveryone(message),
    onJumpToMessage: (messageId) => void jumpToMessage(messageId),
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
          onLoadOlder={async () => { await loadOlder(); }}
          onReachedLatest={reachedLatest}
          onRetry={retry}
          actions={bubbleActions}
          highlightedMessageId={highlightedMessageId}
        />
      )}

      {actionError ? (
        <p role="alert" className="shrink-0 border-t border-destructive/10 bg-destructive/[0.06] px-3 py-1.5 text-center text-[11px] text-destructive">{actionError}</p>
      ) : null}
      {readError ? <p role="alert" className="shrink-0 border-t border-destructive/10 bg-destructive/[0.06] px-3 py-1.5 text-center text-[11px] text-destructive">{readError}</p> : null}

      <ChatComposer
        onSend={send}
        sending={sendingCount > 0}
        reply={reply}
        onCancelReply={() => setReply(null)}
        editing={editing}
        onSubmitEdit={(content) => void submitEdit(content)}
        onCancelEdit={() => {
          setEditing(null);
          setEditError(null);
        }}
        editSaving={editSaving}
        editError={editError}
        onSendVoice={sendVoice}
        voiceSending={voiceSending}
      />
    </div>
  );
}
