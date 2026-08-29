/**
 * Custom worker do @ducanh2912/next-pwa.
 *
 * Este arquivo NAO substitui o service worker gerado pelo Workbox: ele e
 * importado por `public/sw.js` na build. Por isso o cache existente, o
 * funcionamento offline e a instalacao do PWA seguem intactos; aqui so
 * acrescentamos o recebimento de Web Push do chat.
 */

const CHAT_NOTIFICATION_ICON = "/icons/icon-192x192.png";
const CHAT_NOTIFICATION_BADGE = "/icons/icon-192x192.png";

function parsePushPayload(event) {
  if (!event.data) return null;
  try {
    const payload = event.data.json();
    if (!payload || payload.type !== "chat_message") return null;
    if (!payload.conversationId || !payload.messageId) return null;
    return payload;
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  if (!payload) return;

  const title = String(payload.title || "Nova mensagem");
  const body = String(payload.body || "");
  const url = typeof payload.url === "string" && payload.url.startsWith("/")
    ? payload.url
    : "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: CHAT_NOTIFICATION_ICON,
      badge: CHAT_NOTIFICATION_BADGE,
      // Uma notificacao por conversa: mensagens seguidas substituem a anterior
      // em vez de empilhar varias do mesmo remetente.
      tag: `chat:${payload.conversationId}`,
      renotify: true,
      data: {
        type: "chat_message",
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        url,
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const data = (event.notification && event.notification.data) || {};
  if (data.type !== "chat_message") return;

  event.notification.close();

  event.waitUntil(
    (async () => {
      const destino = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/";
      const clientes = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const cliente of clientes) {
        let mesmaOrigem = false;
        try {
          mesmaOrigem = new URL(cliente.url).origin === self.location.origin;
        } catch {
          mesmaOrigem = false;
        }
        if (!mesmaOrigem) continue;

        // A janela ja aberta recebe apenas uma sugestao de navegacao. Quem
        // decide se o usuario pode ver a conversa continua sendo a API.
        if ("focus" in cliente) await cliente.focus();
        cliente.postMessage({
          type: "chat-open-conversation",
          conversationId: data.conversationId,
          messageId: data.messageId,
        });
        return;
      }

      if (self.clients.openWindow) await self.clients.openWindow(destino);
    })(),
  );
});
