/**
 * Smoke test remoto do chat com dois usuários Supabase temporários.
 * Valida canais privados, Presence multiaba, Broadcast, offline/reconexão,
 * contador e leitura. Remove conversas e usuários criados no finally.
 *
 * Uso: npm run db:test:chat-realtime
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";

import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { loadDatabaseConfigs, projectRoot } from "./lib";

const { loadEnvConfig } = createRequire(import.meta.url)("@next/env") as {
  loadEnvConfig: (directory: string) => void;
};

type ChatEvent = {
  kind?: string;
  conversationId?: string;
  clientMessageId?: string;
};

const waitFor = async (condition: () => boolean, label: string, timeoutMs = 8_000) => {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timeout aguardando ${label}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const subscribe = (channel: RealtimeChannel, timeoutMs = 12_000) =>
  new Promise<string>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) resolve("LOCAL_TIMEOUT");
    }, timeoutMs);
    channel.subscribe((status) => {
      if (!["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) return;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    });
  });

async function createAuthenticatedClient(
  url: string,
  anonKey: string,
  email: string,
  password: string,
) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error("Sessão Supabase não criada.");
  await client.realtime.setAuth(data.session.access_token);
  return client;
}

async function main() {
  loadEnvConfig(projectRoot);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceKey) throw new Error("Variáveis Supabase do ERP ausentes.");

  const demo = loadDatabaseConfigs().find((database) => database.key === "demo");
  if (!demo) throw new Error("Demonstração não configurada.");
  assert.equal(
    new URL(url).hostname.split(".")[0],
    demo.projectRef,
    "NEXT_PUBLIC_SUPABASE_URL não aponta para a Demonstração",
  );

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const suffix = crypto.randomUUID();
  const password = `Chat-${crypto.randomUUID()}-aA1!`;
  const users = [
    { email: `chat-a-${suffix}@example.com`, nome: "Chat Smoke A" },
    { email: `chat-b-${suffix}@example.com`, nome: "Chat Smoke B" },
  ];
  const userIds: string[] = [];
  const clients: SupabaseClient[] = [];
  const channels: Array<{
    client: SupabaseClient;
    channel: RealtimeChannel;
    presence?: boolean;
  }> = [];
  let conversationId: string | null = null;

  try {
    for (const user of users) {
      const { data, error } = await admin.auth.admin.createUser({
        email: user.email,
        password,
        email_confirm: true,
        user_metadata: { nome: user.nome },
      });
      if (error || !data.user) throw error ?? new Error("Usuário temporário não criado.");
      userIds.push(data.user.id);
    }

    const [userAId, userBId] = userIds;
    const clientA1 = await createAuthenticatedClient(url, anonKey, users[0].email, password);
    const clientA2 = await createAuthenticatedClient(url, anonKey, users[0].email, password);
    const clientB = await createAuthenticatedClient(url, anonKey, users[1].email, password);
    clients.push(clientA1, clientA2, clientB);

    const eventsA: ChatEvent[] = [];
    const eventsB: ChatEvent[] = [];
    const userChannelA = clientA1
      .channel(`chat:user:${userAId}`, { config: { private: true } })
      .on("broadcast", { event: "chat_changed" }, ({ payload }) => eventsA.push(payload as ChatEvent));
    const userChannelB = clientB
      .channel(`chat:user:${userBId}`, { config: { private: true } })
      .on("broadcast", { event: "chat_changed" }, ({ payload }) => eventsB.push(payload as ChatEvent));
    channels.push(
      { client: clientA1, channel: userChannelA },
      { client: clientB, channel: userChannelB },
    );
    assert.equal(await subscribe(userChannelA), "SUBSCRIBED");
    assert.equal(await subscribe(userChannelB), "SUBSCRIBED");

    const unauthorized = clientA1.channel(`chat:user:${userBId}`, { config: { private: true } });
    assert.equal(await subscribe(unauthorized), "CHANNEL_ERROR");
    await clientA1.removeChannel(unauthorized);

    const presenceA1 = clientA1.channel("chat:presence", {
      config: { private: true, presence: { key: userAId } },
    }).on("presence", { event: "sync" }, () => undefined);
    const presenceA2 = clientA2.channel("chat:presence", {
      config: { private: true, presence: { key: userAId } },
    }).on("presence", { event: "sync" }, () => undefined);
    const presenceB = clientB.channel("chat:presence", {
      config: { private: true, presence: { key: userBId } },
    }).on("presence", { event: "sync" }, () => undefined);
    channels.push(
      { client: clientA1, channel: presenceA1, presence: true },
      { client: clientA2, channel: presenceA2, presence: true },
      { client: clientB, channel: presenceB, presence: true },
    );
    for (const [channel, instance] of [
      [presenceA1, "a-1"],
      [presenceA2, "a-2"],
      [presenceB, "b-1"],
    ] as const) {
      assert.equal(await subscribe(channel), "SUBSCRIBED");
      const trackStatus = await channel.track({ instance, onlineAt: new Date().toISOString() });
      if (trackStatus === "error") throw new Error(`Presence track falhou em ${instance}.`);
      if (trackStatus === "timed out") {
        console.warn(`Presence ${instance}: confirmação expirou; conferindo o estado sincronizado.`);
      }
    }
    await waitFor(() => {
      const state = presenceB.presenceState() as Record<string, unknown[]>;
      return (state[userAId]?.length ?? 0) >= 2 && (state[userBId]?.length ?? 0) >= 1;
    }, "Presence de dois usuários e duas sessões do usuário A");

    const direct = await admin.rpc("chat_get_or_create_direct", {
      p_usuario_atual: userAId,
      p_destinatario: userBId,
    });
    if (direct.error) throw direct.error;
    conversationId = String(direct.data?.[0]?.conversa_id ?? "");
    assert.match(conversationId, /^[0-9a-f-]{36}$/i);

    const firstClientMessageId = crypto.randomUUID();
    const first = await admin.rpc("chat_send_message", {
      p_conversa_id: conversationId,
      p_remetente_id: userAId,
      p_conteudo: "Mensagem A para B",
      p_client_message_id: firstClientMessageId,
    });
    if (first.error) throw first.error;
    await waitFor(
      () => eventsA.some((event) => event.clientMessageId === firstClientMessageId)
        && eventsB.some((event) => event.clientMessageId === firstClientMessageId),
      "Broadcast privado da primeira mensagem",
    );

    const unreadBefore = await admin.rpc("chat_unread_count", { p_usuario_id: userBId });
    if (unreadBefore.error) throw unreadBefore.error;
    assert.equal(Number(unreadBefore.data), 1);

    await clientB.removeChannel(userChannelB);
    const secondClientMessageId = crypto.randomUUID();
    const second = await admin.rpc("chat_send_message", {
      p_conversa_id: conversationId,
      p_remetente_id: userAId,
      p_conteudo: "Mensagem enviada enquanto B está offline",
      p_client_message_id: secondClientMessageId,
    });
    if (second.error) throw second.error;

    const reconnectedEventsB: ChatEvent[] = [];
    const reconnectedB = clientB
      .channel(`chat:user:${userBId}`, { config: { private: true } })
      .on("broadcast", { event: "chat_changed" }, ({ payload }) => reconnectedEventsB.push(payload as ChatEvent));
    channels.push({ client: clientB, channel: reconnectedB });
    assert.equal(await subscribe(reconnectedB), "SUBSCRIBED");
    const history = await admin.rpc("chat_list_messages", {
      p_usuario_id: userBId,
      p_conversa_id: conversationId,
      p_before_at: null,
      p_before_id: null,
      p_limit: 30,
    });
    if (history.error) throw history.error;
    assert.equal(
      history.data.some((message: { client_message_id: string }) =>
        message.client_message_id === secondClientMessageId),
      true,
    );

    const secondMessageId = String(
      history.data.find((message: { client_message_id: string }) =>
        message.client_message_id === secondClientMessageId)?.mensagem_id ?? "",
    );
    const read = await admin.rpc("chat_mark_read", {
      p_usuario_id: userBId,
      p_conversa_id: conversationId,
      p_last_message_id: secondMessageId,
    });
    if (read.error) throw read.error;
    assert.equal(String(read.data?.[0]?.last_read_message_id), secondMessageId);
    const unreadAfter = await admin.rpc("chat_unread_count", { p_usuario_id: userBId });
    if (unreadAfter.error) throw unreadAfter.error;
    assert.equal(Number(unreadAfter.data), 0);

    const replyClientMessageId = crypto.randomUUID();
    const reply = await admin.rpc("chat_send_message", {
      p_conversa_id: conversationId,
      p_remetente_id: userBId,
      p_conteudo: "Resposta B para A",
      p_client_message_id: replyClientMessageId,
    });
    if (reply.error) throw reply.error;
    await waitFor(
      () => eventsA.some((event) => event.clientMessageId === replyClientMessageId),
      "resposta de B recebida por A",
    );

    assert.equal(reconnectedEventsB.some((event) => event.clientMessageId === secondClientMessageId), false);
    console.log(
      "Chat Realtime: dois usuários, isolamento de tópico, Presence multiaba, offline, leitura e resposta validados.",
    );
  } finally {
    for (const { client, channel, presence } of channels.reverse()) {
      if (presence) await channel.untrack({ timeout: 1_000 }).catch(() => undefined);
      await client.removeChannel(channel).catch(() => undefined);
    }
    for (const client of clients) await client.auth.signOut().catch(() => undefined);
    if (conversationId) {
      await admin.from("chat_conversa").delete().eq("id", conversationId);
    }
    for (const userId of userIds.reverse()) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
