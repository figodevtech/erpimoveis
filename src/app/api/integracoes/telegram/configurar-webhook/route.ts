import { NextResponse } from "next/server";
import { requireConfigEdit } from "@/app/api/_authz/perms";
import { configureTelegramWebhook, getTelegramEnvironment } from "@/lib/integrations/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST() {
  try {
    await requireConfigEdit();
    const environment = getTelegramEnvironment();
    if (!environment.configured || !environment.webhookSecret || !environment.cronSecret || !environment.appUrl) {
      return NextResponse.json({ error: "Configure token, username, segredos do webhook/cron e APP_URL." }, { status: 409 });
    }
    const webhookUrl = `${environment.appUrl}/api/integracoes/telegram/webhook`;
    const dispatchUrl = `${environment.appUrl}/api/integracoes/telegram/processar`;
    await configureTelegramWebhook(webhookUrl, environment.webhookSecret);
    const { error: dispatchError } = await supabaseAdmin
      .from("telegram_dispatch_configuracao")
      .upsert({
        id: 1,
        endpoint_url: dispatchUrl,
        bearer_token: environment.cronSecret,
        ativo: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
    if (dispatchError) throw dispatchError;
    return NextResponse.json({ ok: true, webhookUrl, realtime: true });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
    console.error("[telegram-configurar-webhook]", error);
    return NextResponse.json({ error: statusCode === 500 ? "Não foi possível configurar o webhook." : "Sem permissão." }, { status: statusCode });
  }
}
