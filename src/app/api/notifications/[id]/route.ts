import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { notificationErrorResponse, notificationJson, requireNotificationUser } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { userId } = await requireNotificationUser();
    const id = (await params).id;
    if (!/^\d+$/.test(id)) return notificationJson({ error: "Notificação inválida." }, 400);

    const { data: current, error: currentError } = await supabaseAdmin
      .from("system_notification")
      .select("id, metadata, read_at")
      .eq("id", id)
      .eq("usuario_id", userId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return notificationJson({ error: "Notificação não encontrada." }, 404);

    const metadata = current.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
      ? current.metadata as Record<string, unknown>
      : {};
    const { error } = await supabaseAdmin
      .from("system_notification")
      .update({ metadata: { ...metadata, dismissed: true }, read_at: current.read_at ?? new Date().toISOString() })
      .eq("id", id)
      .eq("usuario_id", userId);
    if (error) throw error;
    return notificationJson({ ok: true, id });
  } catch (error) {
    return notificationErrorResponse("DELETE /api/notifications/:id", error);
  }
}
