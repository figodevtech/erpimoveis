import { mercadoLivreSystemNotification } from "@/lib/integrations/mercadolivre-system-notification";
import { notifySalesUsersBatch } from "@/lib/system-notifications";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const RECONCILIATION_HOURS = 48;
const RECONCILIATION_LIMIT = 100;

/**
 * Recupera eventos que foram processados por uma versão antiga do deploy ou
 * durante uma falha temporária da central de avisos. A chave única por usuário
 * torna a operação idempotente.
 */
export async function reconcileMercadoLivreSystemNotifications() {
  const since = new Date(Date.now() - RECONCILIATION_HOURS * 60 * 60 * 1000).toISOString();
  const { data: events, error: eventsError } = await supabaseAdmin
    .from("mercadolivre_notification")
    .select("id, topic, resource, raw_payload")
    .eq("status", "PROCESSADA")
    .gte("processed_at", since)
    .order("processed_at", { ascending: false })
    .limit(RECONCILIATION_LIMIT);
  if (eventsError) throw eventsError;

  const candidates = (events ?? [])
    // Um evento suprimido no processamento não pode voltar por aqui. Sem esta
    // checagem, todo aviso silenciado por eco ou por falta de mudança material
    // reapareceria na próxima vez que alguém abrisse a central.
    .filter((event) => !wasNotificationSuppressed(event))
    .map((event) => notificationFromSnapshot(event) ?? mercadoLivreSystemNotification({
      notificationId: Number(event.id),
      topic: String(event.topic ?? ""),
      resource: String(event.resource ?? ""),
    }))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (!candidates.length) return 0;

  const eventIds = candidates.map((item) => item.sourceEventId);
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("system_notification")
    .select("source_event_id")
    .eq("source", "MERCADOLIVRE_WEBHOOK")
    .in("source_event_id", eventIds);
  if (existingError) throw existingError;

  const existingIds = new Set((existing ?? []).map((item) => String(item.source_event_id)));
  const missing = candidates.filter((item) => !existingIds.has(item.sourceEventId));
  if (!missing.length) return 0;
  return notifySalesUsersBatch(missing);
}

function wasNotificationSuppressed(event: any) {
  const suppression = event?.raw_payload?._erp_notification_suppressed;
  return Boolean(suppression && typeof suppression === "object");
}

function notificationFromSnapshot(event: any) {
  const snapshot = event?.raw_payload?._erp_notification;
  if (!snapshot || typeof snapshot !== "object") return null;
  if (!snapshot.title || !snapshot.message || !snapshot.source || !snapshot.sourceEventId) return null;
  return snapshot as ReturnType<typeof mercadoLivreSystemNotification>;
}
