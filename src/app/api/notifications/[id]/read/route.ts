import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { notificationErrorResponse, notificationJson, requireNotificationUser } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    const { userId } = await requireNotificationUser();
    const id = (await params).id;
    if (!/^\d+$/.test(id)) return notificationJson({ error: "Notificação inválida." }, 400);

    const [{ data, error }, { count, error: countError }] = await Promise.all([
      supabaseAdmin
        .from("system_notification")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .eq("usuario_id", userId)
        .or("metadata->>dismissed.is.null,metadata->>dismissed.neq.true")
        .select("id, read_at")
        .maybeSingle(),
      supabaseAdmin
        .from("system_notification")
        .select("id", { count: "exact", head: true })
        .eq("usuario_id", userId)
        .or("metadata->>dismissed.is.null,metadata->>dismissed.neq.true")
        .is("read_at", null)
        .neq("id", id),
    ]);
    if (error) throw error;
    if (countError) throw countError;
    if (!data) return notificationJson({ error: "Notificação não encontrada." }, 404);
    return notificationJson({ id: String(data.id), readAt: data.read_at, unreadCount: count ?? 0 });
  } catch (error) {
    return notificationErrorResponse("POST /api/notifications/:id/read", error);
  }
}
