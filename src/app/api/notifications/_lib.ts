import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function requireNotificationUser() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw notificationError("Não autenticado.", 401);

  const { data, error } = await supabaseAdmin
    .from("usuario")
    .select("id, ativo")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.ativo === false) throw notificationError("Usuário inativo.", 403);
  return { userId };
}

export function notificationJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function notificationErrorResponse(scope: string, error: unknown) {
  const status = Number((error as any)?.statusCode ?? 500);
  if (status >= 500) console.error(`[notifications] ${scope}`, error);
  return notificationJson(
    { error: error instanceof Error ? error.message : "Falha ao processar notificações." },
    Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500,
  );
}

function notificationError(message: string, statusCode: number) {
  const error = new Error(message);
  (error as any).statusCode = statusCode;
  return error;
}
