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
  notificarFinanceiroDiario: z.boolean(),
  horarioResumoFinanceiro: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  financeiroIncluirAtrasadas: z.boolean(),
  financeiroEnviarSemContas: z.boolean(),
});

function errorResponse(error: unknown, fallback: string) {
  const status = (error as { statusCode?: number })?.statusCode ?? 500;
  return NextResponse.json({ error: status === 500 ? fallback : "Sem permissão." }, { status });
}

export async function GET() {
  try {
    await requireConfigAccess();
    const [usersResult, preferencesResult, financePermissionResult] = await Promise.all([
      supabaseAdmin.from("usuario").select("id, nome, email, ativo, perfilid").order("nome", { ascending: true }),
      supabaseAdmin
        .from("telegram_usuario_preferencia")
        .select("usuario_id, chat_id, telegram_username, telegram_nome, vinculado_em, ativo, modo, escopo, notificar_criacao, status_selecionados, notificar_financeiro_diario, horario_resumo_financeiro, financeiro_incluir_atrasadas, financeiro_enviar_sem_contas, ultimo_erro")
        .order("updated_at", { ascending: false }),
      supabaseAdmin.from("permissao").select("id").ilike("nome", "financeiro:visualizar").maybeSingle(),
    ]);
    if (usersResult.error || preferencesResult.error || financePermissionResult.error) {
      throw usersResult.error ?? preferencesResult.error ?? financePermissionResult.error;
    }
    const financeProfiles = new Set<number>();
    if (financePermissionResult.data?.id) {
      const { data: links, error: linksError } = await supabaseAdmin
        .from("perfilpermissao")
        .select("perfilid")
        .eq("permissaoid", financePermissionResult.data.id);
      if (linksError) throw linksError;
      for (const link of links ?? []) financeProfiles.add(Number(link.perfilid));
    }

    const users = (usersResult.data ?? []).map((user) => ({
      id: String(user.id),
      name: String(user.nome ?? ""),
      email: String(user.email ?? ""),
      active: user.ativo !== false,
      financialAccess: financeProfiles.has(Number(user.perfilid)),
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
      notifyFinancialDaily: row.notificar_financeiro_diario === true,
      financialSummaryTime: String(row.horario_resumo_financeiro ?? "08:00").slice(0, 5),
      financialIncludeOverdue: row.financeiro_incluir_atrasadas !== false,
      financialSendWhenEmpty: row.financeiro_enviar_sem_contas === true,
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

    if (parsed.data.notificarFinanceiroDiario) {
      const { data: target, error: targetError } = await supabaseAdmin
        .from("usuario")
        .select("perfilid")
        .eq("id", parsed.data.usuarioId)
        .single();
      if (targetError) throw targetError;
      const { data: permission } = await supabaseAdmin.from("permissao").select("id").ilike("nome", "financeiro:visualizar").maybeSingle();
      const { data: link, error: linkError } = await supabaseAdmin
        .from("perfilpermissao")
        .select("perfilid")
        .eq("perfilid", target.perfilid)
        .eq("permissaoid", permission?.id ?? -1)
        .maybeSingle();
      if (linkError) throw linkError;
      if (!link) return NextResponse.json({ error: "O usuário precisa ter acesso ao Financeiro para receber esse resumo." }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from("telegram_usuario_preferencia").upsert({
      usuario_id: parsed.data.usuarioId,
      telegram_username: telegramUsername,
      ativo: parsed.data.ativo,
      modo: parsed.data.modo,
      escopo: parsed.data.escopo,
      notificar_criacao: parsed.data.notificarCriacao,
      status_selecionados: Array.from(new Set(parsed.data.statusSelecionados)),
      notificar_financeiro_diario: parsed.data.notificarFinanceiroDiario,
      horario_resumo_financeiro: parsed.data.horarioResumoFinanceiro,
      financeiro_incluir_atrasadas: parsed.data.financeiroIncluirAtrasadas,
      financeiro_enviar_sem_contas: parsed.data.financeiroEnviarSemContas,
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
