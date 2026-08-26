import webpush from "web-push";

import { CHAT_PUSH_MAX_DEVICES, type ChatPushStatus } from "@/lib/chat/contracts";
import type { ChatPushPayload } from "@/lib/chat/push-payload";
import { hashPushEndpoint } from "@/lib/chat/push-payload";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export { buildChatPushPayload, chatPushDeepLink, chatPushPreview, hashPushEndpoint } from "@/lib/chat/push-payload";
export type { ChatPushPayload } from "@/lib/chat/push-payload";

export type ChatPushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  deviceLabel?: string;
};

type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

function readEnv(name: string) {
  return process.env[name]?.trim().replace(/^"|"$/g, "") ?? "";
}

/**
 * Sem as tres variaveis o modulo fica inteiro desligado: nenhuma assinatura e
 * aceita e nenhum envio e tentado. A chave privada nunca chega ao cliente.
 */
export function chatVapidConfig(): VapidConfig | null {
  const publicKey = readEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY");
  const privateKey = readEnv("WEB_PUSH_VAPID_PRIVATE_KEY");
  const subject = readEnv("WEB_PUSH_SUBJECT");
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export function chatPushPublicKey() {
  return chatVapidConfig()?.publicKey ?? null;
}

export async function chatPushStatusFor(userId: string): Promise<ChatPushStatus> {
  const publicKey = chatPushPublicKey();
  if (!publicKey) return { supported: false, vapidPublicKey: null, deviceCount: 0 };

  const { count, error } = await supabaseAdmin
    .from("chat_push_subscription")
    .select("id", { count: "exact", head: true })
    .eq("usuario_id", userId)
    .is("revoked_at", null);
  if (error) throw error;

  return { supported: true, vapidPublicKey: publicKey, deviceCount: count ?? 0 };
}

export async function saveChatPushSubscription(
  userId: string,
  input: ChatPushSubscriptionInput,
  userAgent: string | null,
) {
  if (!chatVapidConfig()) {
    const error = new Error("CHAT_PUSH_NOT_CONFIGURED");
    (error as Error & { statusCode?: number }).statusCode = 503;
    throw error;
  }

  const endpointHash = hashPushEndpoint(input.endpoint);
  const now = new Date().toISOString();

  // O mesmo navegador pode ser reutilizado por outra conta: o endpoint muda de
  // dono em vez de duplicar, e a revogacao anterior e limpa.
  const { error } = await supabaseAdmin.from("chat_push_subscription").upsert(
    {
      usuario_id: userId,
      endpoint: input.endpoint,
      endpoint_hash: endpointHash,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      user_agent: userAgent?.slice(0, 300) ?? null,
      device_label: input.deviceLabel?.slice(0, 80) ?? null,
      updated_at: now,
      last_used_at: null,
      revoked_at: null,
    },
    { onConflict: "endpoint_hash" },
  );
  if (error) throw error;

  await pruneExtraDevices(userId);
  return chatPushStatusFor(userId);
}

/** Mantem um teto razoavel de dispositivos por usuario, do mais antigo pro mais novo. */
async function pruneExtraDevices(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("chat_push_subscription")
    .select("id")
    .eq("usuario_id", userId)
    .is("revoked_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw error;

  const excedentes = (data ?? []).slice(CHAT_PUSH_MAX_DEVICES).map((row) => row.id);
  if (!excedentes.length) return;

  await supabaseAdmin
    .from("chat_push_subscription")
    .update({ revoked_at: new Date().toISOString() })
    .in("id", excedentes);
}

export async function revokeChatPushSubscription(userId: string, endpoint: string) {
  const { error } = await supabaseAdmin
    .from("chat_push_subscription")
    .update({ revoked_at: new Date().toISOString() })
    .eq("usuario_id", userId)
    .eq("endpoint_hash", hashPushEndpoint(endpoint));
  if (error) throw error;
  return chatPushStatusFor(userId);
}

async function revokeByHash(endpointHash: string) {
  await supabaseAdmin
    .from("chat_push_subscription")
    .update({ revoked_at: new Date().toISOString() })
    .eq("endpoint_hash", endpointHash);
}

/**
 * Envia a notificacao para todos os dispositivos validos do destinatario.
 * Retorna quantos envios foram aceitos; nunca lanca para nao derrubar o envio
 * da mensagem, que ja foi persistida com sucesso.
 */
export async function sendChatPush(
  recipientId: string,
  payload: ChatPushPayload,
): Promise<{ enviados: number; revogados: number }> {
  const config = chatVapidConfig();
  if (!config) return { enviados: 0, revogados: 0 };

  const { data, error } = await supabaseAdmin
    .from("chat_push_subscription")
    .select("id, endpoint, endpoint_hash, p256dh, auth")
    .eq("usuario_id", recipientId)
    .is("revoked_at", null)
    .limit(CHAT_PUSH_MAX_DEVICES);
  if (error) throw error;
  if (!data?.length) return { enviados: 0, revogados: 0 };

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const corpo = JSON.stringify(payload);
  const entregues: string[] = [];
  let revogados = 0;

  await Promise.all(
    data.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: String(row.endpoint),
            keys: { p256dh: String(row.p256dh), auth: String(row.auth) },
          },
          corpo,
          { TTL: 60 * 60 * 12, urgency: "high" },
        );
        entregues.push(String(row.id));
      } catch (pushError) {
        const status = (pushError as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          revogados += 1;
          await revokeByHash(String(row.endpoint_hash)).catch(() => undefined);
          return;
        }
        // Nunca logamos endpoint, chaves nem conteudo da mensagem.
        console.error(`[chat] falha no envio de push (status ${status ?? "desconhecido"}).`);
      }
    }),
  );

  if (entregues.length) {
    const { error: touchError } = await supabaseAdmin
      .from("chat_push_subscription")
      .update({ last_used_at: new Date().toISOString() })
      .in("id", entregues);
    if (touchError) console.error("[chat] falha ao registrar uso da subscription.");
  }

  return { enviados: entregues.length, revogados };
}
