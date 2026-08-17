import { NextResponse } from "next/server";
import {
  getTelegramEnvironment,
  hashTelegramLinkToken,
  normalizeTelegramUsername,
  safeSecretMatches,
  sendTelegramMessage,
  type TelegramUpdate,
} from "@/lib/integrations/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function reply(chatId: number, text: string) {
  await sendTelegramMessage({ chatId, text }).catch((error) => {
    console.error("[telegram-webhook] Falha ao responder comando", error);
  });
}

async function handleStart(update: TelegramUpdate, token: string) {
  const message = update.message;
  if (!message?.from || message.chat.type !== "private") return;
  if (!token) {
    await reply(message.chat.id, "Use o link de vínculo gerado em <b>Configurações &gt; Telegram</b> no ERP. O botão Iniciar sozinho não identifica o destinatário.");
    return;
  }
  const tokenHash = hashTelegramLinkToken(token);
  const now = new Date().toISOString();
  const { data: link, error: linkError } = await supabaseAdmin
    .from("telegram_vinculo_token")
    .select("id, usuario_id")
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", now)
    .maybeSingle();
  if (linkError || !link) {
    await reply(message.chat.id, "Este link expirou ou já foi utilizado. Solicite um novo link ao administrador do ERP.");
    return;
  }

  const { data: preference, error: preferenceError } = await supabaseAdmin
    .from("telegram_usuario_preferencia")
    .select("telegram_username")
    .eq("usuario_id", link.usuario_id)
    .maybeSingle();
  const expectedUsername = normalizeTelegramUsername(preference?.telegram_username);
  const receivedUsername = normalizeTelegramUsername(message.from.username);
  if (preferenceError || !expectedUsername) {
    await reply(message.chat.id, "Este contato ainda não foi cadastrado pelo administrador do ERP.");
    return;
  }
  if (!receivedUsername || receivedUsername !== expectedUsername) {
    await reply(
      message.chat.id,
      `Esta conversa não pertence ao usuário <b>@${expectedUsername}</b> cadastrado no ERP. Solicite a correção ao administrador.`,
    );
    return;
  }

  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("telegram_vinculo_token")
    .update({ used_at: now })
    .eq("id", link.id)
    .is("used_at", null)
    .select("usuario_id")
    .maybeSingle();
  if (claimError || !claimed) {
    await reply(message.chat.id, "Este link já foi utilizado. Solicite um novo link ao administrador do ERP.");
    return;
  }

  const displayName = [message.from.first_name, message.from.last_name].filter(Boolean).join(" ").slice(0, 160);
  const { error } = await supabaseAdmin.from("telegram_usuario_preferencia").upsert({
    usuario_id: claimed.usuario_id,
    chat_id: message.chat.id,
    telegram_user_id: message.from.id,
    telegram_username: receivedUsername,
    telegram_nome: displayName || null,
    vinculado_em: now,
    ativo: true,
    ultimo_erro: null,
    updated_at: now,
  }, { onConflict: "usuario_id" });
  if (error) {
    const conflict = error.code === "23505";
    await reply(
      message.chat.id,
      conflict
        ? "Esta conta do Telegram já está conectada a outro usuário do ERP. Desconecte o vínculo anterior primeiro."
        : "Não foi possível concluir a conexão. Gere um novo link e tente novamente.",
    );
    return;
  }
  await reply(message.chat.id, "✅ <b>Telegram conectado</b>\n\nSeus avisos de OS, financeiro e estoque seguirão as preferências definidas no ERP.");
}

async function handleCommand(update: TelegramUpdate) {
  const message = update.message;
  const text = String(message?.text ?? "").trim();
  if (!message || !text.startsWith("/")) return;
  const [rawCommand, argument = ""] = text.split(/\s+/, 2);
  const command = rawCommand.split("@")[0].toLowerCase();
  if (command === "/start") return handleStart(update, argument);

  const { data: preference } = await supabaseAdmin
    .from("telegram_usuario_preferencia")
    .select("usuario_id, ativo, modo, escopo")
    .eq("chat_id", message.chat.id)
    .maybeSingle();
  if (!preference) {
    await reply(message.chat.id, "Esta conversa ainda não foi cadastrada em <b>Configurações &gt; Telegram</b> no ERP.");
    return;
  }
  if (command === "/parar") {
    await supabaseAdmin
      .from("telegram_usuario_preferencia")
      .update({ ativo: false, updated_at: new Date().toISOString() })
      .eq("usuario_id", preference.usuario_id);
    await reply(message.chat.id, "Avisos pausados. Um administrador pode reativá-los nas configurações do ERP.");
    return;
  }
  if (command === "/status") {
    await reply(
      message.chat.id,
      `<b>Avisos:</b> ${preference.ativo ? "ativos" : "pausados"}\n<b>Modo:</b> ${preference.modo}\n<b>Escopo:</b> ${preference.escopo}`,
    );
    return;
  }
  await reply(message.chat.id, "Comandos disponíveis:\n/status — consultar configuração\n/parar — pausar avisos\n/ajuda — exibir esta ajuda");
}

export async function POST(request: Request) {
  const environment = getTelegramEnvironment();
  if (!environment.webhookSecret) {
    return NextResponse.json({ error: "Webhook não configurado." }, { status: 503 });
  }
  const receivedSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!safeSecretMatches(receivedSecret, environment.webhookSecret)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  if (!update || !Number.isSafeInteger(update.update_id)) {
    return NextResponse.json({ error: "Update inválido." }, { status: 400 });
  }

  const { error: dedupeError } = await supabaseAdmin
    .from("telegram_webhook_update")
    .insert({ update_id: update.update_id, resultado: "RECEBIDO" });
  if (dedupeError?.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
  if (dedupeError) return NextResponse.json({ error: "Falha ao registrar update." }, { status: 500 });

  try {
    await handleCommand(update);
    await supabaseAdmin.from("telegram_webhook_update").update({ resultado: "PROCESSADO" }).eq("update_id", update.update_id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[telegram-webhook] Falha ao processar update", error);
    await supabaseAdmin.from("telegram_webhook_update").update({ resultado: "ERRO" }).eq("update_id", update.update_id);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
