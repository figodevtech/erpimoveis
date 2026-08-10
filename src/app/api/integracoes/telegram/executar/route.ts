import { NextResponse } from "next/server";
import { requireConfigEdit } from "@/app/api/_authz/perms";
import { processTelegramNotifications } from "@/lib/ordens/telegram-notifications";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    await requireConfigEdit();
    const result = await processTelegramNotifications();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
    console.error("[telegram-executar]", error);
    return NextResponse.json({ error: statusCode === 500 ? "Não foi possível processar a fila." : "Sem permissão." }, { status: statusCode });
  }
}
