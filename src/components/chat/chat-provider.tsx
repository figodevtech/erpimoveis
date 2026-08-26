"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import type { ChatRealtimeEvent, ConversationSummary } from "@/lib/chat/contracts";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { fetchConversations, fetchRealtimeToken, fetchUnreadCount } from "./chat-api";
import { applyConversationReadCounts } from "./chat-utils";

export type ChatView =
  | { type: "inbox" }
  | { type: "new-conversation" }
  | { type: "conversation"; conversationId: string };

type RealtimeStatus = "connecting" | "connected" | "disconnected" | "unavailable";

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
  const [lastRealtimeEvent, setLastRealtimeEvent] = React.useState<ChatContextValue["lastRealtimeEvent"]>(null);
  const sequenceRef = React.useRef(0);
  const conversationsLoadedRef = React.useRef(false);
  const openRef = React.useRef(false);

  React.useEffect(() => {
    openRef.current = open;
  }, [open]);

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
      if (document.visibilityState === "visible") revalidate();
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
    let userChannel: RealtimeChannel | null = null;
    let presenceChannel: RealtimeChannel | null = null;
    let refreshTimer: number | null = null;

    const updatePresence = () => {
      if (!presenceChannel || disposed) return;
      setOnlineIds(new Set(Object.keys(presenceChannel.presenceState())));
    };

    const handleStatus = (status: string) => {
      if (disposed) return;
      if (status === "SUBSCRIBED") {
        setRealtimeStatus("connected");
        revalidate();
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        setRealtimeStatus("disconnected");
      }
    };

    const authenticateRealtime = async () => {
      const credentials = await fetchRealtimeToken();
      if (disposed) return;
      await supabaseBrowser.realtime.setAuth(credentials.token);
      const delay = Math.max(30_000, new Date(credentials.expiresAt).getTime() - Date.now() - 60_000);
      refreshTimer = window.setTimeout(() => {
        void authenticateRealtime().catch(() => setRealtimeStatus("disconnected"));
      }, delay);
    };

    const connect = async () => {
      setRealtimeStatus("connecting");
      try {
        await authenticateRealtime();
        if (disposed) return;

        userChannel = supabaseBrowser
          .channel(`chat:user:${currentUserId}`, { config: { private: true } })
          .on("broadcast", { event: "chat_changed" }, ({ payload }) => {
            const event = payload as ChatRealtimeEvent;
            if (!event?.conversationId || !event?.kind) return;
            sequenceRef.current += 1;
            setLastRealtimeEvent({ sequence: sequenceRef.current, event });
            void refreshUnread().catch(() => undefined);
            if (openRef.current) void refreshConversations();
          })
          .subscribe(handleStatus);

        presenceChannel = supabaseBrowser
          .channel("chat:presence", {
            config: { private: true, presence: { key: currentUserId } },
          })
          .on("presence", { event: "sync" }, updatePresence)
          .on("presence", { event: "join" }, updatePresence)
          .on("presence", { event: "leave" }, updatePresence)
          .subscribe((status) => {
            handleStatus(status);
            if (status === "SUBSCRIBED" && presenceChannel) {
              void presenceChannel.track({ onlineAt: new Date().toISOString() });
            }
          });
      } catch (error) {
        if (disposed) return;
        const code = (error as { code?: string })?.code;
        setRealtimeStatus(code === "CHAT_REALTIME_NOT_CONFIGURED" ? "unavailable" : "disconnected");
      }
    };

    void connect();

    return () => {
      disposed = true;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      setOnlineIds(new Set());
      if (presenceChannel) void presenceChannel.untrack().catch(() => undefined);
      if (userChannel) void supabaseBrowser.removeChannel(userChannel);
      if (presenceChannel) void supabaseBrowser.removeChannel(presenceChannel);
    };
  }, [currentUserId, refreshConversations, refreshUnread, revalidate, sessionStatus]);

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
        lastRealtimeEvent,
        handleConversationRead,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
