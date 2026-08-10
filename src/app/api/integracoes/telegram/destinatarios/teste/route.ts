import { NextResponse } from "next/server";
import { z } from "zod";
import { requireConfigEdit } from "@/app/api/_authz/perms";
import { sendTelegramMessage } from "@/lib/integrations/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireConfigEdit();
    const parsed = z.object({ usuarioId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Usuário inválido." }, { status: 400 });
    const { data, error } = await supabaseAdmin
      .from("telegram_usuario_preferencia")
      .select("chat_id")
      .eq("usuario_id", parsed.data.usuarioId)
      .maybeSingle();
    if (error) throw error;
    if (!data?.chat_id) return NextResponse.json({ error: "Este destinatário ainda não iniciou o bot." }, { status: 409 });
    await sendTelegramMessage({
      chatId: Number(data.chat_id),
      text: "✅ <b>Teste concluído</b>\n\nEste contato receberá os avisos de ordens de serviço configurados no ERP.",
    });
    await supabaseAdmin
      .from("telegram_usuario_preferencia")
      .update({ ultimo_teste_em: new Date().toISOString(), ultimo_erro: null, updated_at: new Date().toISOString() })
      .eq("usuario_id", parsed.data.usuarioId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode ?? 500;
    return NextResponse.json({ error: status === 500 ? "Não foi possível enviar a mensagem de teste." : "Sem permissão." }, { status });
  }
}
