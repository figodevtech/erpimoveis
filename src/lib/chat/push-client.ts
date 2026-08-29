"use client";

/**
 * Utilitarios de Web Push no navegador. A deteccao e sempre por recurso
 * disponivel; o user agent so e usado para explicar requisitos de plataforma,
 * nunca para decidir se o recurso existe.
 */

export type ChatPushSupport =
  | { state: "supported" }
  | { state: "unsupported"; reason: string };

export function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;
  const standaloneIos = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return Boolean(
    standaloneIos
    || window.matchMedia?.("(display-mode: standalone)").matches
    || window.matchMedia?.("(display-mode: fullscreen)").matches,
  );
}

/** Apenas para orientar o usuario; a decisao real vem da deteccao de recursos. */
export function isAppleTouchDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iosClassico = /iPad|iPhone|iPod/.test(ua);
  // iPadOS moderno se apresenta como Macintosh com tela sensivel ao toque.
  const iPadOs = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return iosClassico || iPadOs;
}

export function detectChatPushSupport(): ChatPushSupport {
  if (typeof window === "undefined") {
    return { state: "unsupported", reason: "Recurso disponível somente no navegador." };
  }
  if (!window.isSecureContext) {
    return { state: "unsupported", reason: "As notificações exigem uma conexão segura (HTTPS)." };
  }
  if (!("Notification" in window)) {
    return { state: "unsupported", reason: "Este navegador não oferece notificações." };
  }
  if (!("serviceWorker" in navigator)) {
    return { state: "unsupported", reason: "Este navegador não oferece service worker." };
  }
  if (!("PushManager" in window)) {
    if (isAppleTouchDevice() && !isStandaloneDisplay()) {
      return {
        state: "unsupported",
        reason:
          "No iPhone e no iPad as notificações exigem o ERP adicionado à Tela de Início. Use Compartilhar e depois “Adicionar à Tela de Início”, abra o ERP por lá e ative novamente.",
      };
    }
    return { state: "unsupported", reason: "Este navegador não oferece Web Push." };
  }
  if (isAppleTouchDevice() && !isStandaloneDisplay()) {
    return {
      state: "unsupported",
      reason:
        "No iPhone e no iPad as notificações só funcionam com o ERP adicionado à Tela de Início. Instale o app e ative por dentro dele.",
    };
  }
  return { state: "supported" };
}

export function currentNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function base64UrlParaUint8Array(base64Url: string) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const buffer = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) buffer[index] = raw.charCodeAt(index);
  return buffer;
}

async function registrationPronta() {
  // O service worker e registrado pelo next-pwa; aqui apenas esperamos por ele.
  return navigator.serviceWorker.ready;
}

export async function currentPushSubscription() {
  if (detectChatPushSupport().state !== "supported") return null;
  const registration = await registrationPronta();
  return registration.pushManager.getSubscription();
}

export type ChatPushSubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

function serializar(subscription: PushSubscription): ChatPushSubscriptionPayload | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

/**
 * Pede a permissao e cria a subscription. Deve ser chamada somente dentro do
 * gesto explicito do usuario; nunca no carregamento do ERP.
 */
export async function requestChatPushSubscription(vapidPublicKey: string) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { permission, subscription: null as ChatPushSubscriptionPayload | null };

  const registration = await registrationPronta();
  const existente = await registration.pushManager.getSubscription();

  // Uma subscription antiga pode ter sido criada com outra chave VAPID.
  if (existente) {
    const serializada = serializar(existente);
    const chaveAtual = existente.options?.applicationServerKey;
    const mesmaChave = chaveAtual
      ? btoa(String.fromCharCode(...new Uint8Array(chaveAtual)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "") === vapidPublicKey.replace(/=+$/, "")
      : false;
    if (serializada && mesmaChave) return { permission, subscription: serializada };
    await existente.unsubscribe().catch(() => undefined);
  }

  const criada = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlParaUint8Array(vapidPublicKey),
  });

  return { permission, subscription: serializar(criada) };
}

/** Remove somente a subscription deste dispositivo. */
export async function removeChatPushSubscription() {
  const subscription = await currentPushSubscription();
  if (!subscription) return null;
  const serializada = serializar(subscription);
  await subscription.unsubscribe().catch(() => undefined);
  return serializada;
}
