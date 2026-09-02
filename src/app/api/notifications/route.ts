import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { reconcileMercadoLivreSystemNotifications } from "@/lib/integrations/mercadolivre-system-notification-reconciliation";
import { notificationErrorResponse, notificationJson, requireNotificationUser } from "./_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { userId } = await requireNotificationUser();
    await reconcileMercadoLivreSystemNotifications().catch((error) => {
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

export async function DELETE() {
  try {
    const { userId } = await requireNotificationUser();
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("system_notification")
      .update({ metadata: { dismissed: true }, read_at: now })
      .eq("usuario_id", userId)
      .or("metadata->>dismissed.is.null,metadata->>dismissed.neq.true");
    if (error) throw error;
    return notificationJson({ ok: true, unreadCount: 0 });
  } catch (error) {
    return notificationErrorResponse("DELETE /api/notifications", error);
  }
}
