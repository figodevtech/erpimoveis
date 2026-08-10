import { NextResponse } from "next/server";
import { requireConfigEdit } from "@/app/api/_authz/perms";
import { configureTelegramWebhook, getTelegramEnvironment } from "@/lib/integrations/telegram";

export const runtime = "nodejs";

export async function POST() {
  try {
    await requireConfigEdit();
    const environment = getTelegramEnvironment();
    if (!environment.configured || !environment.webhookSecret || !environment.appUrl) {
      return NextResponse.json({ error: "Configure token, username, segredo do webhook e APP_URL." }, { status: 409 });
    }
    const webhookUrl = `${environment.appUrl}/api/integracoes/telegram/webhook`;
    await configureTelegramWebhook(webhookUrl, environment.webhookSecret);
    return NextResponse.json({ ok: true, webhookUrl });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
    return NextResponse.json({ error: statusCode === 500 ? "Não foi possível configurar o webhook." : "Sem permissão." }, { status: statusCode });
  }
}
