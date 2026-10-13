"use client";

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { ordensRealtimeCredentialsSchema, ordensRealtimeTableSchema, type OrdensRealtimeCredentials, type OrdensRealtimeTable } from "./realtime-contracts";

type Listener = (table?: OrdensRealtimeTable) => void;
type Client = Pick<SupabaseClient, "channel" | "removeChannel" | "realtime">;
type Dependencies = {
  fetchCredentials: (signal: AbortSignal) => Promise<OrdensRealtimeCredentials>;
  createClient: (accessToken: () => Promise<string | null>) => Client;
  onChange: Listener;
};

/** Uma conexão por usuário; token e socket independentes do chat. */
export function createOrdensRealtimeConnection(deps: Dependencies) {
  let disposed = false;
  let ticket = 0;
  let attempt = 0;
  let client: Client | null = null;
  let channel: RealtimeChannel | null = null;
  let credentials: OrdensRealtimeCredentials | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let renewal: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController();

  const removeChannel = async () => {
    const previous = channel;
    const previousClient = client;
    channel = null;
    client = null;
    if (previous && previousClient) await previousClient.removeChannel(previous).catch(() => undefined);
    previousClient?.realtime.disconnect();
  };
  const retryLater = () => {
    if (disposed || retry !== undefined) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5));
    retry = setTimeout(() => { retry = undefined; void connect(); }, delay);
  };
  const renew = async () => {
    const current = ticket;
    try {
      const next = await deps.fetchCredentials(abort.signal);
      if (disposed || current !== ticket) return;
      if (next.topic !== credentials?.topic || next.userId !== credentials.userId) {
        void connect();
        return;
      }
      credentials = next;
      await client?.realtime.setAuth(next.token);
      if (!disposed && current === ticket) scheduleRenewal();
    } catch {
      if (!disposed && current === ticket) retryLater();
    }
  };
  const scheduleRenewal = () => {
    clearTimeout(renewal);
    const delay = Math.max(1000, new Date(credentials!.expiresAt).getTime() - Date.now() - 60_000);
    renewal = setTimeout(() => { void renew(); }, delay);
  };
  const connect = async () => {
    if (disposed) return;
    clearTimeout(retry);
    retry = undefined;
    clearTimeout(renewal);
    const current = ++ticket;
    const active = () => !disposed && current === ticket;
    await removeChannel();
    if (!active()) return;
    try {
      const next = await deps.fetchCredentials(abort.signal);
      if (!active()) return;
      credentials = next;
      client ??= deps.createClient(async () => credentials?.token ?? null);
      await client.realtime.setAuth(next.token);
      if (!active()) return;
      channel = client.channel(next.topic, { config: { private: true } })
        .on("broadcast", { event: "ordens_changed" }, ({ payload }) => {
          const parsed = ordensRealtimeTableSchema.safeParse(payload?.table);
          if (active() && parsed.success) deps.onChange(parsed.data);
        })
        .subscribe(status => {
          if (!active()) return;
          if (status === "SUBSCRIBED") {
            clearTimeout(retry);
            retry = undefined;
            attempt = 0;
            scheduleRenewal();
            // Reconcilia alterações ocorridas antes do join ou durante a queda.
            deps.onChange();
          } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) retryLater();
        });
    } catch {
      if (active()) retryLater();
    }
  };
  void connect();
  return {
    reconnect: () => { void connect(); },
    dispose: () => {
      disposed = true;
      ticket++;
      abort.abort();
      clearTimeout(retry);
      clearTimeout(renewal);
      void removeChannel();
    },
  };
}

const connections = new Map<string, { listeners: Set<Listener>; stop: () => void }>();

export function subscribeOrdensRealtime(userId: string, listener: Listener) {
  let shared = connections.get(userId);
  if (!shared) {
    const listeners = new Set<Listener>([listener]);
    const connection = createOrdensRealtimeConnection({
      fetchCredentials: async signal => {
        const response = await fetch("/api/ordens/realtime-token", { cache: "no-store", signal });
        if (!response.ok) throw new Error("Credencial de realtime indisponível");
        const credentials = ordensRealtimeCredentialsSchema.parse(await response.json());
        if (credentials.userId !== userId) throw new Error("Sessão alterada");
        return credentials;
      },
      createClient: accessToken => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        // REST usa a chave pública; a credencial de usuário fica só no socket.
        accessToken: async () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        realtime: { accessToken },
      }),
      onChange: table => listeners.forEach(callback => callback(table)),
    });
    window.addEventListener("online", connection.reconnect);
    shared = { listeners, stop: () => {
      window.removeEventListener("online", connection.reconnect);
      connection.dispose();
    } };
    connections.set(userId, shared);
  } else shared.listeners.add(listener);
  const current = shared;
  return () => {
    current.listeners.delete(listener);
    if (!current.listeners.size) {
      current.stop();
      if (connections.get(userId) === current) connections.delete(userId);
    }
  };
}
