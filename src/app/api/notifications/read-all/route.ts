import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { notificationErrorResponse, notificationJson, requireNotificationUser } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { userId } = await requireNotificationUser();
    const { error } = await supabaseAdmin
      .from("system_notification")
      .update({ read_at: new Date().toISOString() })
      .eq("usuario_id", userId)
      .or("metadata->>dismissed.is.null,metadata->>dismissed.neq.true")
      .is("read_at", null);
    if (error) throw error;
    return notificationJson({ ok: true, unreadCount: 0 });
  } catch (error) {
    return notificationErrorResponse("POST /api/notifications/read-all", error);
  }
}
