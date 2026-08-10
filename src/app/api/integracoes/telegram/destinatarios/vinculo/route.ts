import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireConfigEdit } from "@/app/api/_authz/perms";
import { getTelegramEnvironment } from "@/lib/integrations/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireConfigEdit();
    const parsed = z.object({ usuarioId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Usuário inválido." }, { status: 400 });
    const environment = getTelegramEnvironment();
    if (!environment.configured) return NextResponse.json({ error: "Configure o bot antes de gerar vínculos." }, { status: 409 });

    const { data: preference, error: preferenceError } = await supabaseAdmin
      .from("telegram_usuario_preferencia")
      .select("telegram_username, chat_id")
      .eq("usuario_id", parsed.data.usuarioId)
      .maybeSingle();
    if (preferenceError) throw preferenceError;
    if (!preference?.telegram_username) return NextResponse.json({ error: "Salve o destinatário antes de gerar o vínculo." }, { status: 409 });
    if (preference.chat_id) return NextResponse.json({ error: "Este destinatário já está conectado." }, { status: 409 });

    const now = new Date().toISOString();
    await supabaseAdmin.from("telegram_vinculo_token").update({ used_at: now }).eq("usuario_id", parsed.data.usuarioId).is("used_at", null);
    const token = randomBytes(24).toString("base64url");
    const { error } = await supabaseAdmin.from("telegram_vinculo_token").insert({
      usuario_id: parsed.data.usuarioId,
      token_hash: createHash("sha256").update(token).digest("hex"),
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (error) throw error;
    return NextResponse.json({ url: `https://t.me/${environment.botUsername}?start=${token}`, expiresInSeconds: 600 });
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode ?? 500;
    return NextResponse.json({ error: status === 500 ? "Não foi possível gerar o vínculo." : "Sem permissão." }, { status });
  }
}
