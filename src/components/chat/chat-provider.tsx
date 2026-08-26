"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import type { ChatRealtimeEvent, ConversationSummary } from "@/lib/chat/contracts";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  clearChatRealtimeToken,
  setChatRealtimeTokenSource,
  storeChatRealtimeToken,
} from "@/lib/chat/realtime-token";
import { fetchConversations, fetchMessages, fetchRealtimeToken, fetchUnreadCount } from "./chat-api";
import {
  dismissIncomingChatMessageToast,
  isIncomingMessageNotification,
  showIncomingChatMessageToast,
} from "./chat-message-toast";
import type { ChatRealtimeStatus } from "./chat-utils";
import { applyConversationReadCounts, nextReconnectDelay } from "./chat-utils";

export type ChatView =
  | { type: "inbox" }
  | { type: "new-conversation" }
  | { type: "conversation"; conversationId: string };

type RealtimeStatus = ChatRealtimeStatus;

/** Status de canal que o realtime-js reporta quando a assinatura caiu. */
const STATUS_DE_QUEDA = ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"];

/**
 * Uma oscilacao curta nao deve piscar o aviso na tela; so avisamos quando a
 * queda persiste depois de a primeira tentativa de reconexao ja ter falhado.
 */
const ATRASO_DO_AVISO_MS = 2_500;

/** Sem Realtime, o chat aberto se mantem util relendo por HTTP. */
const INTERVALO_DEGRADADO_MS = 15_000;

type ChatContextValue = {
  currentUserId: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  view: ChatView;
  showInbox: () => void;
  showNewConversation: () => void;
  showConversation: (conversation: ConversationSummary) => void;
  selectedConversation: ConversationSummary | null;
  conversations: ConversationSummary[];
  conversationsLoading: boolean;
  conversationsError: string | null;
  refreshConversations: () => Promise<void>;
  unreadCount: number;
  setUnreadCount: React.Dispatch<React.SetStateAction<number>>;
  isOnline: (userId: string) => boolean;
  realtimeStatus: RealtimeStatus;
  realtimeBannerVisible: boolean;
  reconnectRealtime: () => void;
  degradedPollTick: number;
  lastRealtimeEvent: { sequence: number; event: ChatRealtimeEvent } | null;
  handleConversationRead: (conversationId: string, conversationUnread: number, globalUnread: number) => void;
};

const ChatContext = React.createContext<ChatContextValue | null>(null);

export function useChat() {
  const context = React.useContext(ChatContext);
  if (!context) throw new Error("useChat deve ser usado dentro de ChatProvider");
  return context;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status: sessionStatus } = useSession();
  const currentUserId = session?.user?.id ?? "";
  const [open, setOpenState] = React.useState(false);
  const [view, setView] = React.useState<ChatView>({ type: "inbox" });
  const [selectedConversation, setSelectedConversation] = React.useState<ConversationSummary | null>(null);
  const [conversations, setConversations] = React.useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = React.useState(false);
  const [conversationsError, setConversationsError] = React.useState<string | null>(null);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [onlineIds, setOnlineIds] = React.useState<Set<string>>(() => new Set());
  const [realtimeStatus, setRealtimeStatus] = React.useState<RealtimeStatus>("connecting");
  const [realtimeBannerVisible, setRealtimeBannerVisible] = React.useState(false);
  const [degradedPollTick, setDegradedPollTick] = React.useState(0);
  const [lastRealtimeEvent, setLastRealtimeEvent] = React.useState<ChatContextValue["lastRealtimeEvent"]>(null);
  const sequenceRef = React.useRef(0);
  const conversationsLoadedRef = React.useRef(false);
  const openRef = React.useRef(false);
  const realtimeStatusRef = React.useRef<RealtimeStatus>("connecting");
  // Preenchido pelo efeito do Realtime; e por ele que o botao do aviso e o
  // retorno de foco pedem uma tentativa imediata sem recriar a conexao.
  const reconnectNowRef = React.useRef<(() => void) | null>(null);
  const notifiedMessageIdsRef = React.useRef(new Set<string>());

  React.useEffect(() => {
    openRef.current = open;
  }, [open]);

  React.useEffect(() => {
    realtimeStatusRef.current = realtimeStatus;
  }, [realtimeStatus]);

  React.useEffect(() => {
    const notifiedIds = notifiedMessageIdsRef.current;
    return () => {
      notifiedIds.forEach(dismissIncomingChatMessageToast);
      notifiedIds.clear();
    };
  }, [currentUserId]);

  const refreshUnread = React.useCallback(async () => {
    if (!currentUserId) return;
    const result = await fetchUnreadCount();
    setUnreadCount(result.unreadCount);
  }, [currentUserId]);

  const refreshConversations = React.useCallback(async () => {
    if (!currentUserId) return;
    if (!conversationsLoadedRef.current) setConversationsLoading(true);
    setConversationsError(null);
    try {
      const result = await fetchConversations();
      setConversations(result.conversations);
      setSelectedConversation((selected) =>
        selected ? result.conversations.find((item) => item.id === selected.id) ?? selected : null,
      );
      conversationsLoadedRef.current = true;
    } catch {
      setConversationsError("Não foi possível carregar as conversas.");
    } finally {
      setConversationsLoading(false);
    }
  }, [currentUserId]);

  const revalidate = React.useCallback(() => {
    void refreshUnread().catch(() => undefined);
    if (openRef.current) void refreshConversations();
  }, [refreshConversations, refreshUnread]);

  const notifyIncomingMessage = React.useCallback(async (
    event: ChatRealtimeEvent,
    signal?: AbortSignal,
  ) => {
    if (
      !isIncomingMessageNotification(event, currentUserId, openRef.current)
      || !event.messageId
    ) return;

    const notifiedIds = notifiedMessageIdsRef.current;
    if (notifiedIds.has(event.messageId)) return;
    notifiedIds.add(event.messageId);
    if (notifiedIds.size > 200) {
      const oldestId = notifiedIds.values().next().value;
      if (oldestId) notifiedIds.delete(oldestId);
    }

    try {
      const [conversationResult, messagePage] = await Promise.all([
        fetchConversations(signal),
        fetchMessages(event.conversationId, null, signal),
      ]);
      const conversation = conversationResult.conversations.find(
        (item) => item.id === event.conversationId,
      );
      const message = messagePage.messages.find((item) => item.id === event.messageId);
      if (
        openRef.current
        || !conversation
        || !message
        || message.senderId !== event.senderId
      ) return;
      showIncomingChatMessageToast(conversation, message);
    } catch {
      notifiedIds.delete(event.messageId);
    }
  }, [currentUserId]);

  React.useEffect(() => {
    if (sessionStatus !== "authenticated" || !currentUserId) return;
    void refreshUnread().catch(() => undefined);
  }, [currentUserId, refreshUnread, sessionStatus]);

  React.useEffect(() => {
    if (open) void refreshConversations();
  }, [open, refreshConversations]);

  React.useEffect(() => {
    if (sessionStatus !== "authenticated" || !currentUserId) return;
    const handleReturn = () => {
      if (document.visibilityState !== "visible") return;
      revalidate();
      // Voltar para a aba, recuperar a rede ou reganhar o foco sao os melhores
      // momentos para tentar de novo: encurtam qualquer backoff em andamento.
      if (realtimeStatusRef.current === "disconnected") reconnectNowRef.current?.();
    };
    window.addEventListener("focus", handleReturn);
    window.addEventListener("online", handleReturn);
    document.addEventListener("visibilitychange", handleReturn);
    return () => {
      window.removeEventListener("focus", handleReturn);
      window.removeEventListener("online", handleReturn);
      document.removeEventListener("visibilitychange", handleReturn);
    };
  }, [currentUserId, revalidate, sessionStatus]);

  React.useEffect(() => {
    if (sessionStatus !== "authenticated" || !currentUserId) return;

    let disposed = false;
    // Cada tentativa de conexao tira um bilhete no inicio; so a mais recente
    // segue valida. Callbacks de canais antigos que chegarem atrasados sao
    // descartados em vez de sobrescrever o status ou criar canais duplicados.
    let tentativaAtual = 0;
    let attempt = 0;
    let reconnectTimer: number | null = null;
    let userChannel: RealtimeChannel | null = null;
    let presenceChannel: RealtimeChannel | null = null;
    const notificationController = new AbortController();

    // O cliente do Supabase pede o token por este canal a cada join e rejoin.
    setChatRealtimeTokenSource(fetchRealtimeToken);

    const clearReconnectTimer = () => {
      if (reconnectTimer === null) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    // Devolve a promessa da remocao: recriar um canal enquanto o anterior ainda
    // esta saindo faria o servidor ver dois joins no mesmo topico.
    const teardown = async () => {
      const canalAnterior = userChannel;
      const presencaAnterior = presenceChannel;
      userChannel = null;
      presenceChannel = null;
      setOnlineIds(new Set());
      if (presencaAnterior) await presencaAnterior.untrack().catch(() => undefined);
      await Promise.all([
        canalAnterior ? supabaseBrowser.removeChannel(canalAnterior).catch(() => undefined) : undefined,
        presencaAnterior ? supabaseBrowser.removeChannel(presencaAnterior).catch(() => undefined) : undefined,
      ]);
    };

    const scheduleReconnect = () => {
      // `unavailable` significa servidor sem o segredo configurado: insistir so
      // gera ruido, porque nenhuma tentativa vai passar.
      if (disposed || reconnectTimer !== null || realtimeStatusRef.current === "unavailable") return;
      const delay = nextReconnectDelay(attempt);
      attempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const handleChannelStatus = (
      status: string,
      ativa: () => boolean,
      { atualizaAviso }: { atualizaAviso: boolean },
    ) => {
      if (!ativa()) return false;
      if (status === "SUBSCRIBED") {
        if (atualizaAviso) {
          // So o canal de mensagens zera o backoff: se a presenca subisse e ele
          // nao, a espera nunca cresceria e ficariamos retentando a cada segundo.
          attempt = 0;
          setRealtimeStatus("connected");
          revalidate();
        }
        return true;
      }
      if (STATUS_DE_QUEDA.includes(status)) {
        if (atualizaAviso) setRealtimeStatus("disconnected");
        else setOnlineIds(new Set());
        scheduleReconnect();
      }
      return false;
    };

    const connect = async () => {
      if (disposed) return;
      const bilhete = ++tentativaAtual;
      const ativa = () => !disposed && bilhete === tentativaAtual;

      // Um canal em estado de erro nao volta com `subscribe()`: o realtime-js so
      // reassina canais fechados. Recriar e o unico caminho de recuperacao.
      await teardown();
      if (!ativa()) return;

      setRealtimeStatus("connecting");

      try {
        const credentials = await fetchRealtimeToken();
        if (!ativa()) return;
        storeChatRealtimeToken(credentials);
        await supabaseBrowser.realtime.setAuth(credentials.token);
        if (!ativa()) return;

        userChannel = supabaseBrowser
          .channel(`chat:user:${currentUserId}`, { config: { private: true } })
          .on("broadcast", { event: "chat_changed" }, ({ payload }) => {
            if (!ativa()) return;
            const event = payload as ChatRealtimeEvent;
            if (!event?.conversationId || !event?.kind) return;
            sequenceRef.current += 1;
            setLastRealtimeEvent({ sequence: sequenceRef.current, event });
            void notifyIncomingMessage(event, notificationController.signal);
            void refreshUnread().catch(() => undefined);
            if (openRef.current) void refreshConversations();
          })
          .subscribe((status) => {
            handleChannelStatus(status, ativa, { atualizaAviso: true });
          });

        const canalDePresenca = supabaseBrowser.channel("chat:presence", {
          config: { private: true, presence: { key: currentUserId } },
        });
        const updatePresence = () => {
          if (!ativa()) return;
          setOnlineIds(new Set(Object.keys(canalDePresenca.presenceState())));
        };

        presenceChannel = canalDePresenca
          .on("presence", { event: "sync" }, updatePresence)
          .on("presence", { event: "join" }, updatePresence)
          .on("presence", { event: "leave" }, updatePresence)
          .subscribe((status) => {
            // A presenca nao mexe no aviso: perde-la deixa as bolinhas em
            // offline, mas as mensagens continuam chegando pelo outro canal.
            const assinou = handleChannelStatus(status, ativa, { atualizaAviso: false });
            if (assinou) void canalDePresenca.track({ onlineAt: new Date().toISOString() });
          });
      } catch (error) {
        if (!ativa()) return;
        const code = (error as { code?: string })?.code;
        if (code === "CHAT_REALTIME_NOT_CONFIGURED") {
          setRealtimeStatus("unavailable");
          return;
        }
        setRealtimeStatus("disconnected");
        scheduleReconnect();
      }
    };

    const reconnectNow = () => {
      if (disposed || realtimeStatusRef.current === "unavailable") return;
      clearReconnectTimer();
      attempt = 0;
      void connect();
    };
    reconnectNowRef.current = reconnectNow;

    void connect();

    return () => {
      disposed = true;
      reconnectNowRef.current = null;
      notificationController.abort();
      clearReconnectTimer();
      void teardown();
      setChatRealtimeTokenSource(null);
      clearChatRealtimeToken();
    };
  }, [currentUserId, notifyIncomingMessage, refreshConversations, refreshUnread, revalidate, sessionStatus]);

  React.useEffect(() => {
    if (realtimeStatus === "connected") {
      setRealtimeBannerVisible(false);
      return;
    }
    if (realtimeStatus === "unavailable") {
      setRealtimeBannerVisible(true);
      return;
    }
    // `connecting` mantem o aviso como esta: durante o backoff a conexao
    // alterna entre tentar e falhar, e esconder a cada tentativa faria o aviso
    // piscar. Quem some com ele e o `connected` la em cima.
    if (realtimeStatus === "connecting") return;

    const timer = window.setTimeout(() => setRealtimeBannerVisible(true), ATRASO_DO_AVISO_MS);
    return () => window.clearTimeout(timer);
  }, [realtimeStatus]);

  React.useEffect(() => {
    if (!open || realtimeStatus !== "disconnected") return;

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setDegradedPollTick((value) => value + 1);
      revalidate();
    }, INTERVALO_DEGRADADO_MS);

    return () => window.clearInterval(timer);
  }, [open, realtimeStatus, revalidate]);

  const setOpen = React.useCallback((next: boolean) => {
    setOpenState(next);
    if (!next) {
      setView({ type: "inbox" });
      setSelectedConversation(null);
    }
  }, []);

  const showConversation = React.useCallback((conversation: ConversationSummary) => {
    setSelectedConversation(conversation);
    setView({ type: "conversation", conversationId: conversation.id });
  }, []);

  const reconnectRealtime = React.useCallback(() => {
    reconnectNowRef.current?.();
  }, []);

  const handleConversationRead = React.useCallback(
    (conversationId: string, conversationUnread: number, globalUnread: number) => {
      setUnreadCount(globalUnread);
      setConversations((items) => applyConversationReadCounts(items, conversationId, conversationUnread));
    },
    [],
  );

  return (
    <ChatContext.Provider
      value={{
        currentUserId,
        open,
        setOpen,
        view,
        showInbox: () => {
          setView({ type: "inbox" });
          setSelectedConversation(null);
        },
        showNewConversation: () => setView({ type: "new-conversation" }),
        showConversation,
        selectedConversation,
        conversations,
        conversationsLoading,
        conversationsError,
        refreshConversations,
        unreadCount,
        setUnreadCount,
        isOnline: (userId) => onlineIds.has(userId),
        realtimeStatus,
        realtimeBannerVisible,
        reconnectRealtime,
        degradedPollTick,
        lastRealtimeEvent,
        handleConversationRead,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
