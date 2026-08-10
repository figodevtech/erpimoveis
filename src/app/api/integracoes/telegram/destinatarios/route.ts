import { NextResponse } from "next/server";
import { z } from "zod";
import { requireConfigAccess, requireConfigEdit } from "@/app/api/_authz/perms";
import { normalizeTelegramUsername } from "@/lib/integrations/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statusValues = [
  "AGUARDANDO_CHECKLIST", "ORCAMENTO", "APROVACAO_ORCAMENTO", "ORCAMENTO_APROVADO",
  "ORCAMENTO_RECUSADO", "EM_ANDAMENTO", "PAGAMENTO", "SEM_COBRANCA", "CONCLUIDO", "CANCELADO",
] as const;

const recipientSchema = z.object({
  usuarioId: z.string().uuid(),
  telegramUsername: z.string().trim().min(1).max(33),
  ativo: z.boolean(),
  modo: z.enum(["CRIACAO", "CRIACAO_FINALIZACAO", "TODOS", "PERSONALIZADO"]),
  escopo: z.enum(["TODAS", "MINHAS", "MEU_SETOR"]),
  notificarCriacao: z.boolean(),
  statusSelecionados: z.array(z.enum(statusValues)).max(statusValues.length),
});

function errorResponse(error: unknown, fallback: string) {
  const status = (error as { statusCode?: number })?.statusCode ?? 500;
  return NextResponse.json({ error: status === 500 ? fallback : "Sem permissão." }, { status });
}

export async function GET() {
  try {
    await requireConfigAccess();
    const [usersResult, preferencesResult] = await Promise.all([
      supabaseAdmin.from("usuario").select("id, nome, email, ativo").order("nome", { ascending: true }),
      supabaseAdmin
        .from("telegram_usuario_preferencia")
        .select("usuario_id, chat_id, telegram_username, telegram_nome, vinculado_em, ativo, modo, escopo, notificar_criacao, status_selecionados, ultimo_erro")
        .order("updated_at", { ascending: false }),
    ]);
    if (usersResult.error || preferencesResult.error) throw usersResult.error ?? preferencesResult.error;

    const users = (usersResult.data ?? []).map((user) => ({
      id: String(user.id),
      name: String(user.nome ?? ""),
      email: String(user.email ?? ""),
      active: user.ativo !== false,
    }));
    const userById = new Map(users.map((user) => [user.id, user]));
    const recipients = (preferencesResult.data ?? []).map((row) => ({
      usuarioId: String(row.usuario_id),
      user: userById.get(String(row.usuario_id)) ?? null,
      connected: Boolean(row.chat_id),
      telegramUsername: row.telegram_username ? String(row.telegram_username) : "",
      telegramName: row.telegram_nome ? String(row.telegram_nome) : null,
      linkedAt: row.vinculado_em ? String(row.vinculado_em) : null,
      active: row.ativo !== false,
      mode: String(row.modo),
      scope: String(row.escopo),
      notifyCreation: row.notificar_criacao !== false,
      selectedStatuses: Array.isArray(row.status_selecionados) ? row.status_selecionados : [],
      lastError: row.ultimo_erro ? String(row.ultimo_erro) : null,
    }));
    return NextResponse.json({ users, recipients });
  } catch (error) {
    return errorResponse(error, "Não foi possível carregar os destinatários.");
  }
}

export async function PUT(request: Request) {
  try {
    await requireConfigEdit();
    const parsed = recipientSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Cadastro de destinatário inválido." }, { status: 400 });
    const telegramUsername = normalizeTelegramUsername(parsed.data.telegramUsername);
    if (!telegramUsername) {
      return NextResponse.json({ error: "Informe um usuário válido do Telegram, como @lucas_figo." }, { status: 400 });
    }

    const { data: duplicate, error: duplicateError } = await supabaseAdmin
      .from("telegram_usuario_preferencia")
      .select("usuario_id")
      .eq("telegram_username", telegramUsername)
      .neq("usuario_id", parsed.data.usuarioId)
      .limit(1)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) return NextResponse.json({ error: "Este usuário do Telegram já está cadastrado para outro destinatário." }, { status: 409 });

    const { data: current, error: currentError } = await supabaseAdmin
      .from("telegram_usuario_preferencia")
      .select("chat_id, telegram_username")
      .eq("usuario_id", parsed.data.usuarioId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (current?.chat_id && normalizeTelegramUsername(current.telegram_username) !== telegramUsername) {
      return NextResponse.json({ error: "Remova o vínculo atual antes de alterar o usuário do Telegram." }, { status: 409 });
    }

    const { error } = await supabaseAdmin.from("telegram_usuario_preferencia").upsert({
      usuario_id: parsed.data.usuarioId,
      telegram_username: telegramUsername,
      ativo: parsed.data.ativo,
      modo: parsed.data.modo,
      escopo: parsed.data.escopo,
      notificar_criacao: parsed.data.notificarCriacao,
      status_selecionados: Array.from(new Set(parsed.data.statusSelecionados)),
      ultimo_erro: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "usuario_id" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Não foi possível salvar o destinatário.");
  }
}

export async function DELETE(request: Request) {
  try {
    await requireConfigEdit();
    const usuarioId = new URL(request.url).searchParams.get("usuarioId") ?? "";
    if (!z.string().uuid().safeParse(usuarioId).success) {
      return NextResponse.json({ error: "Usuário inválido." }, { status: 400 });
    }
    const now = new Date().toISOString();
    const results = await Promise.all([
      supabaseAdmin.from("telegram_vinculo_token").update({ used_at: now }).eq("usuario_id", usuarioId).is("used_at", null),
      supabaseAdmin.from("os_notificacao_entrega").update({ status: "DESCARTADO", updated_at: now }).eq("usuario_id", usuarioId).in("status", ["PENDENTE", "ENVIANDO", "ERRO"]),
    ]);
    const preparationError = results.find((result) => result.error)?.error;
    if (preparationError) throw preparationError;
    const { error } = await supabaseAdmin.from("telegram_usuario_preferencia").delete().eq("usuario_id", usuarioId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Não foi possível remover o destinatário.");
  }
}
