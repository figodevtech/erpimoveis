import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { reconcileMercadoLivreSystemNotifications } from "@/lib/integrations/mercadolivre-system-notification-reconciliation";
import { createSharedLookup } from "@/lib/shared-lookup";
import { notificationErrorResponse, notificationJson, requireNotificationUser } from "./_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A reconciliacao so recupera eventos do Mercado Livre que escaparam da central
 * de avisos, e e idempotente. Rodava em toda leitura da central (duas consultas
 * a mais); agora roda no maximo uma vez por intervalo nesta instancia, com as
 * leituras simultaneas esperando a mesma execucao. Falha nao fica guardada: a
 * proxima leitura tenta de novo.
 */
const RECONCILIACAO_INTERVALO_MS = 5 * 60_000;
const reconciliarUmaVezPorIntervalo = createSharedLookup<number>({ ttlMs: RECONCILIACAO_INTERVALO_MS });

function reconciliarMercadoLivre() {
  return reconciliarUmaVezPorIntervalo("mercadolivre", reconcileMercadoLivreSystemNotifications);
}

export async function GET(request: Request) {
  try {
    const { userId } = await requireNotificationUser();
    await reconciliarMercadoLivre().catch((error) => {
      console.error("Falha ao reconciliar notificações processadas do Mercado Livre", error);
    });
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 40), 1), 100);

    const [{ data, error }, { count, error: countError }] = await Promise.all([
      supabaseAdmin
        .from("system_notification")
        .select("id, category, priority, title, message, href, source, metadata, read_at, created_at")
        .eq("usuario_id", userId)
        .or("metadata->>dismissed.is.null,metadata->>dismissed.neq.true")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit),
      supabaseAdmin
        .from("system_notification")
        .select("id", { count: "exact", head: true })
        .eq("usuario_id", userId)
        .or("metadata->>dismissed.is.null,metadata->>dismissed.neq.true")
        .is("read_at", null),
    ]);
    if (error) throw error;
    if (countError) throw countError;

    return notificationJson({
      notifications: (data ?? []).map((item) => ({
        id: String(item.id),
        category: item.category,
        priority: item.priority,
        title: item.title,
        message: item.message,
        href: item.href,
        source: item.source,
        metadata: item.metadata ?? {},
        readAt: item.read_at,
        createdAt: item.created_at,
      })),
      unreadCount: count ?? 0,
    });
  } catch (error) {
    return notificationErrorResponse("GET /api/notifications", error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { userId } = await requireNotificationUser();
    const body = await request.json().catch(() => ({}));
    const requestedIds = Array.isArray(body?.ids)
      ? body.ids.map((value: unknown) => String(value)).filter((value: string) => /^\d+$/.test(value)).slice(0, 100)
      : [];
    let ids = requestedIds;
    if (!ids.length) {
      const { data: visible, error: visibleError } = await supabaseAdmin
        .from("system_notification")
        .select("id")
        .eq("usuario_id", userId)
        .or("metadata->>dismissed.is.null,metadata->>dismissed.neq.true")
        .order("created_at", { ascending: false })
        .limit(100);
      if (visibleError) throw visibleError;
      ids = (visible ?? []).map((item) => String(item.id));
    }
    if (!ids.length) return notificationJson({ ok: true, unreadCount: 0 });

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("system_notification")
      .update({ metadata: { dismissed: true }, read_at: now })
      .eq("usuario_id", userId)
      .in("id", ids);
    if (error) throw error;
    return notificationJson({ ok: true, unreadCount: 0 });
  } catch (error) {
    return notificationErrorResponse("DELETE /api/notifications", error);
  }
}
