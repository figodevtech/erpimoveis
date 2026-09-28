"use client";

import * as React from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import type { OperationalConnectionStatus } from "@/lib/central-operacional/contracts";
import {
  clearChatRealtimeToken,
  setChatRealtimeTokenSource,
  storeChatRealtimeToken,
} from "@/lib/chat/realtime-token";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useSessionReady } from "@/components/use-session-ready";
import { fetchOperationalRealtimeCredentials, OperationalApiError } from "../lib/api";

const FALL_STATUSES = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);

export function nextOperationalReconnectDelay(attempt: number) {
  return Math.min(30_000, 1_000 * 2 ** Math.min(5, Math.max(0, attempt)));
}

export function operationalConnectionStatus(input: {
  online: boolean;
  subscribed: boolean;
  connectedBefore: boolean;
}): OperationalConnectionStatus {
  if (!input.online) return "OFFLINE";
  if (input.subscribed) return "LIVE";
  return input.connectedBefore ? "RECONNECTING" : "CONNECTING";
}

export function useOperationalRealtime({
  onInvalidate,
  onReconnect,
}: {
  onInvalidate: () => void;
  onReconnect: () => void;
}) {
  // A renovacao de permissoes nao muda `ready`/`userId`: o canal so e refeito
  // no logout ou na troca de usuario.
  const { ready: sessionReady, userId } = useSessionReady();
  const [status, setStatus] = React.useState<OperationalConnectionStatus>("CONNECTING");
  const [onlineUsers, setOnlineUsers] = React.useState<number | null>(null);
  const statusRef = React.useRef<OperationalConnectionStatus>("CONNECTING");
  const invalidateRef = React.useRef(onInvalidate);
  const reconnectRef = React.useRef(onReconnect);
  const reconnectNowRef = React.useRef<() => void>(() => undefined);

  React.useEffect(() => {
    invalidateRef.current = onInvalidate;
    reconnectRef.current = onReconnect;
  }, [onInvalidate, onReconnect]);

  React.useEffect(() => {
    statusRef.current = status;
  }, [status]);

  React.useEffect(() => {
    if (!sessionReady || !userId) return;

    let disposed = false;
    let operationalChannel: RealtimeChannel | null = null;
    let presenceChannel: RealtimeChannel | null = null;
    let retryTimer: number | null = null;
    let attempt = 0;
    let connectionTicket = 0;
    let connectedBefore = false;
    const tokenAbort = new AbortController();

    const tokenSource = async () => {
      const credentials = await fetchOperationalRealtimeCredentials(tokenAbort.signal);
      return { token: credentials.token, expiresAt: credentials.expiresAt };
    };
    setChatRealtimeTokenSource(tokenSource);

    const clearRetry = () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = null;
    };

    const teardown = async () => {
      const operational = operationalChannel;
      const presence = presenceChannel;
      operationalChannel = null;
      presenceChannel = null;
      setOnlineUsers(null);
      if (presence) await presence.untrack({ timeout: 800 }).catch(() => undefined);
      await Promise.all([
        operational ? supabaseBrowser.removeChannel(operational).catch(() => undefined) : Promise.resolve(),
        presence ? supabaseBrowser.removeChannel(presence).catch(() => undefined) : Promise.resolve(),
      ]);
    };

    const scheduleReconnect = () => {
      if (disposed || retryTimer !== null || !navigator.onLine) return;
      const delay = nextOperationalReconnectDelay(attempt);
      attempt += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (disposed) return;
      clearRetry();
      const ticket = ++connectionTicket;
      const active = () => !disposed && ticket === connectionTicket;

      if (!navigator.onLine) {
        setStatus("OFFLINE");
        await teardown();
        return;
      }

      setStatus(operationalConnectionStatus({ online: true, subscribed: false, connectedBefore }));
      await teardown();
      if (!active()) return;

      try {
        const credentials = await fetchOperationalRealtimeCredentials(tokenAbort.signal);
        if (!active()) return;
        storeChatRealtimeToken(credentials);
        await supabaseBrowser.realtime.setAuth(credentials.token);
        if (!active()) return;

        operationalChannel = supabaseBrowser
          .channel(credentials.topic, { config: { private: true } })
          .on("broadcast", { event: "operational_changed" }, () => {
            if (active()) invalidateRef.current();
          })
          .subscribe((channelStatus) => {
            if (!active()) return;
            if (channelStatus === "SUBSCRIBED") {
              const wasReconnect = connectedBefore;
              connectedBefore = true;
              attempt = 0;
              setStatus("LIVE");
              if (wasReconnect) reconnectRef.current();
              return;
            }
            if (FALL_STATUSES.has(channelStatus)) {
              setStatus(navigator.onLine ? "RECONNECTING" : "OFFLINE");
              scheduleReconnect();
            }
          });

        const presence = supabaseBrowser.channel("chat:presence", {
          config: { private: true, presence: { key: userId } },
        });
        const updatePresence = () => {
          if (!active()) return;
          setOnlineUsers(Object.keys(presence.presenceState()).length);
        };
        presenceChannel = presence
          .on("presence", { event: "sync" }, updatePresence)
          .on("presence", { event: "join" }, updatePresence)
          .on("presence", { event: "leave" }, updatePresence)
          .subscribe((channelStatus) => {
            if (!active()) return;
            if (channelStatus === "SUBSCRIBED") {
              void presence.track({ onlineAt: new Date().toISOString(), surface: "central-operacional" });
            } else if (FALL_STATUSES.has(channelStatus)) {
              setOnlineUsers(null);
            }
          });
      } catch (error) {
        if (!active() || (error instanceof DOMException && error.name === "AbortError")) return;
        if (error instanceof OperationalApiError && error.status === 401) return;
        setStatus(navigator.onLine ? "RECONNECTING" : "OFFLINE");
        scheduleReconnect();
      }
    };

    const reconnectNow = () => {
      if (disposed) return;
      attempt = 0;
      void connect();
    };
    reconnectNowRef.current = reconnectNow;

    const handleOffline = () => {
      setStatus("OFFLINE");
      clearRetry();
      void teardown();
    };
    const handleOnline = () => reconnectNow();
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && statusRef.current !== "LIVE") reconnectNow();
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleVisibility);
    document.addEventListener("visibilitychange", handleVisibility);
    void connect();

    return () => {
      disposed = true;
      connectionTicket += 1;
      reconnectNowRef.current = () => undefined;
      tokenAbort.abort();
      clearRetry();
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleVisibility);
      document.removeEventListener("visibilitychange", handleVisibility);
      setChatRealtimeTokenSource(null);
      clearChatRealtimeToken();
      void teardown();
    };
  }, [sessionReady, userId]);

  return {
    status,
    onlineUsers,
    reconnect: React.useCallback(() => reconnectNowRef.current(), []),
  };
}
