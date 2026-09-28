"use client";

import * as React from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { useSessionReady } from "@/components/use-session-ready";
import { onAppResume } from "@/lib/app-resume";

import type { ChatPushStatus, ChatRealtimeEvent, ConversationSummary } from "@/lib/chat/contracts";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  clearChatRealtimeToken,
  ensureChatRealtimeCredentials,
  setChatRealtimeTokenSource,
} from "@/lib/chat/realtime-token";
import type { ChatPushSupport } from "@/lib/chat/push-client";
import {
  currentNotificationPermission,
  currentPushSubscription,
  detectChatPushSupport,
  removeChatPushSubscription,
  requestChatPushSubscription,
} from "@/lib/chat/push-client";
import {
  deletePushSubscription,
  fetchConversations,
  fetchMessages,
  fetchPushStatus,
  fetchRealtimeToken,
  fetchUnreadCount,
  postPushSubscription,
} from "./chat-api";
import {
  dismissIncomingChatMessageToast,
  isIncomingMessageNotification,
  showIncomingChatMessageToast,
} from "./chat-message-toast";
import type { ChatRealtimeStatus } from "./chat-utils";
import { applyConversationReadCounts, eventChangesUnread, nextReconnectDelay } from "./chat-utils";

export type ChatView =
  | { type: "inbox" }
  | { type: "new-conversation" }
  | { type: "settings" }
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

/**
 * Com o Realtime conectado, o contador ja chega pelos eventos. Voltar para a
 * aba so confere de novo depois deste intervalo desde a ultima leitura.
 */
const REVALIDACAO_NO_RETORNO_MS = 30_000;

/** Rajada de eventos (varias mensagens seguidas) vira uma leitura do contador. */
const AGRUPAMENTO_UNREAD_MS = 400;

type ChatContextValue = {
  currentUserId: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  view: ChatView;
  showInbox: () => void;
  showNewConversation: () => void;
  showSettings: () => void;
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
  /** Conversa e mensagem sugeridas por um deep link de notificacao. */
  pendingMessageFocus: PendingMessageFocus;
  consumePendingMessageFocus: () => void;
  push: ChatPushState;
};

type PendingMessageFocus = { conversationId: string; messageId: string | null } | null;

export type ChatPushState = {
  support: ChatPushSupport;
  permission: NotificationPermission | "unsupported";
  /** `null` enquanto o status do servidor ainda nao foi lido. */
  status: ChatPushStatus | null;
  enabledOnThisDevice: boolean;
  busy: boolean;
  error: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
};

/** Duas tentativas bastam: um deep link para conversa alheia nunca aparece. */
const MAX_TENTATIVAS_DEEP_LINK = 2;

const ChatContext = React.createContext<ChatContextValue | null>(null);

export function useChat() {
  const context = React.useContext(ChatContext);
  if (!context) throw new Error("useChat deve ser usado dentro de ChatProvider");
  return context;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  // `ready`/`userId` nao mudam na renovacao de permissoes (`update()`), so no
  // logout ou na troca de usuario — que desmontam os canais na hora.
  const { ready: sessionReady, userId: sessionUserId } = useSessionReady();
  const currentUserId = sessionUserId ?? "";
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
  const ultimaLeituraUnreadRef = React.useRef(0);
  const conversationsLoadedRef = React.useRef(false);
  const openRef = React.useRef(false);
  const realtimeStatusRef = React.useRef<RealtimeStatus>("connecting");
  // Preenchido pelo efeito do Realtime; e por ele que o botao do aviso e o
  // retorno de foco pedem uma tentativa imediata sem recriar a conexao.
  const reconnectNowRef = React.useRef<(() => void) | null>(null);
  const notifiedMessageIdsRef = React.useRef(new Set<string>());
  const [pendingMessageFocus, setPendingMessageFocus] = React.useState<PendingMessageFocus>(null);
  const tentativasDeepLinkRef = React.useRef(0);
  const [pushSupport, setPushSupport] = React.useState<ChatPushSupport>({ state: "supported" });
  const [pushPermission, setPushPermission] = React.useState<NotificationPermission | "unsupported">("default");
  const [pushStatus, setPushStatus] = React.useState<ChatPushStatus | null>(null);
  const [pushEnabledHere, setPushEnabledHere] = React.useState(false);
  const [pushBusy, setPushBusy] = React.useState(false);
  const [pushError, setPushError] = React.useState<string | null>(null);

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
    ultimaLeituraUnreadRef.current = Date.now();
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
    if (!sessionReady || !currentUserId) return;
    void refreshUnread().catch(() => undefined);
  }, [currentUserId, refreshUnread, sessionReady]);

  React.useEffect(() => {
    if (open) void refreshConversations();
  }, [open, refreshConversations]);

  React.useEffect(() => {
    if (!sessionReady || !currentUserId) return;
    // Foco, aba visivel e rede de volta chegam juntos: um aviso por retorno.
    return onAppResume(() => {
      // Voltar para a aba, recuperar a rede ou reganhar o foco sao os melhores
      // momentos para tentar de novo: encurtam qualquer backoff em andamento.
      if (realtimeStatusRef.current === "disconnected") {
        revalidate();
        reconnectNowRef.current?.();
        return;
      }
      if (Date.now() - ultimaLeituraUnreadRef.current >= REVALIDACAO_NO_RETORNO_MS) revalidate();
    }, { includeOnline: true });
  }, [currentUserId, revalidate, sessionReady]);

  React.useEffect(() => {
    if (!sessionReady || !currentUserId) return;

    let disposed = false;
    // Cada tentativa de conexao tira um bilhete no inicio; so a mais recente
    // segue valida. Callbacks de canais antigos que chegarem atrasados sao
    // descartados em vez de sobrescrever o status ou criar canais duplicados.
    let tentativaAtual = 0;
    let attempt = 0;
    let reconnectTimer: number | null = null;
    let unreadTimer: number | null = null;
    let userChannel: RealtimeChannel | null = null;
    let presenceChannel: RealtimeChannel | null = null;
    const notificationController = new AbortController();

    // O cliente do Supabase pede o token por este canal a cada join e rejoin.
    setChatRealtimeTokenSource(fetchRealtimeToken);

    const agendarLeituraUnread = () => {
      if (unreadTimer !== null) return;
      unreadTimer = window.setTimeout(() => {
        unreadTimer = null;
        if (!disposed) void refreshUnread().catch(() => undefined);
      }, AGRUPAMENTO_UNREAD_MS);
    };

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
        if (atualizaAviso) {
          setRealtimeStatus("disconnected");
          scheduleReconnect();
        } else {
          // Presença é complementar. Se ela não estiver autorizada ou oscilar,
          // as mensagens continuam operacionais; reiniciar os dois canais aqui
          // criava um ciclo de token + unread-count a cada poucos segundos.
          setOnlineIds(new Set());
        }
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
        const credentials = await ensureChatRealtimeCredentials(fetchRealtimeToken);
        if (!ativa()) return;
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
            if (eventChangesUnread(event, currentUserId)) agendarLeituraUnread();
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
      if (unreadTimer !== null) window.clearTimeout(unreadTimer);
      void teardown();
      setChatRealtimeTokenSource(null);
      clearChatRealtimeToken();
    };
  }, [currentUserId, notifyIncomingMessage, refreshConversations, refreshUnread, revalidate, sessionReady]);

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

  const consumePendingMessageFocus = React.useCallback(() => {
    setPendingMessageFocus(null);
    tentativasDeepLinkRef.current = 0;
  }, []);

  const solicitarFoco = React.useCallback((conversationId: string, messageId: string | null) => {
    if (!conversationId) return;
    tentativasDeepLinkRef.current = 0;
    setPendingMessageFocus({ conversationId, messageId });
    setOpenState(true);
  }, []);

  React.useEffect(() => {
    // Deep link do push em partida fria: os parametros apenas orientam a
    // interface e sao removidos logo em seguida para nao reabrir sem parar.
    if (typeof window === "undefined" || !sessionReady) return;
    const url = new URL(window.location.href);
    const conversationId = url.searchParams.get("chat");
    if (!conversationId) return;
    const messageId = url.searchParams.get("message");

    url.searchParams.delete("chat");
    url.searchParams.delete("message");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    solicitarFoco(conversationId, messageId);
  }, [sessionReady, solicitarFoco]);

  React.useEffect(() => {
    // Clique na notificacao com o ERP ja aberto: o service worker avisa a aba.
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const handler = (event: MessageEvent) => {
      const data = event.data as { type?: string; conversationId?: string; messageId?: string } | null;
      if (data?.type !== "chat-open-conversation" || !data.conversationId) return;
      solicitarFoco(data.conversationId, data.messageId ?? null);
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [solicitarFoco]);

  React.useEffect(() => {
    if (!pendingMessageFocus) return;
    const conversation = conversations.find((item) => item.id === pendingMessageFocus.conversationId);

    if (conversation) {
      showConversation(conversation);
      // Sem mensagem alvo o pedido termina aqui; com ela, a conversa consome.
      if (!pendingMessageFocus.messageId) consumePendingMessageFocus();
      return;
    }

    // A autorizacao continua sendo da API: se a conversa nao for do usuario,
    // ela simplesmente nunca aparece e o pedido e descartado.
    if (tentativasDeepLinkRef.current >= MAX_TENTATIVAS_DEEP_LINK) {
      consumePendingMessageFocus();
      return;
    }
    tentativasDeepLinkRef.current += 1;
    void refreshConversations();
  }, [
    consumePendingMessageFocus,
    conversations,
    pendingMessageFocus,
    refreshConversations,
    showConversation,
  ]);

  React.useEffect(() => {
    if (!sessionReady || !currentUserId) return;
    let ativo = true;

    const carregar = async () => {
      const support = detectChatPushSupport();
      if (!ativo) return;
      setPushSupport(support);
      setPushPermission(currentNotificationPermission());

      try {
        const status = await fetchPushStatus();
        if (!ativo) return;
        setPushStatus(status);
      } catch {
        if (ativo) setPushStatus(null);
      }

      if (support.state !== "supported") return;
      try {
        const subscription = await currentPushSubscription();
        if (ativo) setPushEnabledHere(Boolean(subscription));
      } catch {
        if (ativo) setPushEnabledHere(false);
      }
    };

    void carregar();
    return () => { ativo = false; };
  }, [currentUserId, sessionReady]);

  const enablePush = React.useCallback(async () => {
    setPushBusy(true);
    setPushError(null);
    try {
      const support = detectChatPushSupport();
      setPushSupport(support);
      if (support.state !== "supported") {
        setPushError(support.reason);
        return;
      }

      const status = await fetchPushStatus();
      setPushStatus(status);
      if (!status.supported || !status.vapidPublicKey) {
        setPushError("O servidor ainda não está configurado para enviar notificações.");
        return;
      }

      const resultado = await requestChatPushSubscription(status.vapidPublicKey);
      setPushPermission(resultado.permission);

      if (resultado.permission === "denied") {
        setPushError(
          "As notificações estão bloqueadas. Libere o ERP nas configurações do navegador ou do sistema e ative novamente.",
        );
        return;
      }
      if (!resultado.subscription) {
        setPushError("A permissão não foi concedida. Nenhuma notificação será enviada.");
        return;
      }

      setPushStatus(await postPushSubscription(resultado.subscription));
      setPushEnabledHere(true);
    } catch {
      setPushError("Não foi possível ativar as notificações agora.");
    } finally {
      setPushBusy(false);
    }
  }, []);

  const disablePush = React.useCallback(async () => {
    setPushBusy(true);
    setPushError(null);
    try {
      const removida = await removeChatPushSubscription();
      // Somente este dispositivo sai; celular, tablet e outros navegadores do
      // mesmo usuario continuam recebendo.
      if (removida) setPushStatus(await deletePushSubscription(removida.endpoint));
      setPushEnabledHere(false);
    } catch {
      setPushError("Não foi possível desativar as notificações agora.");
    } finally {
      setPushBusy(false);
    }
  }, []);

  const push = React.useMemo<ChatPushState>(() => ({
    support: pushSupport,
    permission: pushPermission,
    status: pushStatus,
    enabledOnThisDevice: pushEnabledHere,
    busy: pushBusy,
    error: pushError,
    enable: enablePush,
    disable: disablePush,
  }), [disablePush, enablePush, pushBusy, pushEnabledHere, pushError, pushPermission, pushStatus, pushSupport]);

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
        showSettings: () => setView({ type: "settings" }),
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
        pendingMessageFocus,
        consumePendingMessageFocus,
        push,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
