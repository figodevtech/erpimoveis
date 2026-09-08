import { NextResponse } from "next/server";
import { z } from "zod";
import { requireConfigAccess, requireConfigEdit } from "@/app/api/_authz/perms";
import { isStockNotificationEvent, STOCK_NOTIFICATION_EVENT_VALUES } from "@/lib/estoque/telegram-stock-events";
import { FISCAL_NOTIFICATION_EVENT_VALUES, isFiscalNotificationEvent } from "@/lib/fiscal/telegram-fiscal-events";
import {
  FINANCEIRO_NOTIFICATION_EVENT_VALUES,
  FINANCEIRO_ORIGEM_VALUES,
  isFinanceiroNotificationEvent,
  isFinanceiroOrigem,
} from "@/lib/financeiro/telegram-financeiro-events";
import { normalizeTelegramUsername } from "@/lib/integrations/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statusValues = [
  "AGUARDANDO_CHECKLIST", "ORCAMENTO", "APROVACAO_ORCAMENTO", "ORCAMENTO_APROVADO",
  "ORCAMENTO_RECUSADO", "EM_ANDAMENTO", "PAGAMENTO", "FATURAMENTO", "SEM_COBRANCA", "CONCLUIDO", "CANCELADO",
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
  notificarReceberDiario: z.boolean(),
  horarioResumoReceber: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  receberIncluirVencidas: z.boolean(),
  receberEnviarSemContas: z.boolean(),
  estoqueEventosSelecionados: z
    .array(z.string())
    .max(STOCK_NOTIFICATION_EVENT_VALUES.length)
    .refine((events) => events.every(isStockNotificationEvent)),
  fiscalEventosSelecionados: z
    .array(z.string())
    .max(FISCAL_NOTIFICATION_EVENT_VALUES.length)
    .refine((events) => events.every(isFiscalNotificationEvent)),
  notificarMarketplace: z.boolean(),
  financeiroEventosSelecionados: z
    .array(z.string())
    .max(FINANCEIRO_NOTIFICATION_EVENT_VALUES.length)
    .refine((events) => events.every(isFinanceiroNotificationEvent)),
  // Zero é "sem piso"; vazio, em origens e bancos, é "todas".
  financeiroValorMinimo: z.number().min(0).max(99_999_999),
  financeiroOrigensSelecionadas: z
    .array(z.string())
    .max(FINANCEIRO_ORIGEM_VALUES.length)
    .refine((origens) => origens.every(isFinanceiroOrigem)),
  financeiroBancosSelecionados: z.array(z.number().int().positive()).max(100),
});

function errorResponse(error: unknown, fallback: string) {
  const status = (error as { statusCode?: number })?.statusCode ?? 500;
  return NextResponse.json({ error: status === 500 ? fallback : "Sem permissão." }, { status });
}

async function userHasPermission(usuarioId: string, permissionName: string) {
  const [{ data: target, error: targetError }, { data: permission, error: permissionError }] = await Promise.all([
    supabaseAdmin.from("usuario").select("perfilid").eq("id", usuarioId).single(),
    supabaseAdmin.from("permissao").select("id").ilike("nome", permissionName).maybeSingle(),
  ]);
  if (targetError || permissionError) throw targetError ?? permissionError;
  if (!permission?.id) return false;
  const { data: link, error: linkError } = await supabaseAdmin
    .from("perfilpermissao")
    .select("perfilid")
    .eq("perfilid", target.perfilid)
    .eq("permissaoid", permission.id)
    .maybeSingle();
  if (linkError) throw linkError;
  return Boolean(link);
}

export async function GET() {
  try {
    await requireConfigAccess();
    const [usersResult, preferencesResult, permissionsResult, banksResult] = await Promise.all([
      supabaseAdmin.from("usuario").select("id, nome, email, ativo, perfilid").order("nome", { ascending: true }),
      supabaseAdmin
        .from("telegram_usuario_preferencia")
        .select("usuario_id, chat_id, telegram_username, telegram_nome, vinculado_em, ativo, modo, escopo, notificar_criacao, status_selecionados, notificar_financeiro_diario, horario_resumo_financeiro, financeiro_incluir_atrasadas, financeiro_enviar_sem_contas, notificar_receber_diario, horario_resumo_receber, receber_incluir_vencidas, receber_enviar_sem_contas, estoque_eventos_selecionados, fiscal_eventos_selecionados, notificar_marketplace, financeiro_eventos_selecionados, financeiro_valor_minimo, financeiro_origens_selecionadas, financeiro_bancos_selecionados, ultimo_erro")
        .order("updated_at", { ascending: false }),
      supabaseAdmin
        .from("permissao")
        .select("id, nome"),
      // Contas ativas alimentam o filtro opcional dos avisos instantâneos.
      supabaseAdmin
        .from("bancoconta")
        .select("id, titulo")
        .eq("ativo", true)
        .order("titulo", { ascending: true }),
    ]);
    if (usersResult.error || preferencesResult.error || permissionsResult.error || banksResult.error) {
      throw usersResult.error ?? preferencesResult.error ?? permissionsResult.error ?? banksResult.error;
    }
    const banks = (banksResult.data ?? []).map((bank) => ({
      id: Number(bank.id),
      titulo: String(bank.titulo ?? `Conta #${bank.id}`),
    }));

    const relevantPermissionNames = new Set([
      "financeiro:visualizar",
      "estoque:visualizar",
      "financeiro:notas_fiscais",
      "vendas:visualizar",
    ]);
    const permissionIdByName = new Map(
      (permissionsResult.data ?? [])
        .map((permission) => [String(permission.nome).toLowerCase(), Number(permission.id)] as const)
        .filter(([name]) => relevantPermissionNames.has(name)),
    );
    const permissionIds = [...permissionIdByName.values()];
    let permissionLinks: Array<{ perfilid: number; permissaoid: number }> = [];
    if (permissionIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("perfilpermissao")
        .select("perfilid, permissaoid")
        .in("permissaoid", permissionIds);
      if (error) throw error;
      permissionLinks = (data ?? []).map((link) => ({
        perfilid: Number(link.perfilid),
        permissaoid: Number(link.permissaoid),
      }));
    }

    const financeProfiles = new Set<number>();
    const stockProfiles = new Set<number>();
    const fiscalProfiles = new Set<number>();
    const salesProfiles = new Set<number>();
    const financePermissionId = permissionIdByName.get("financeiro:visualizar");
    const stockPermissionId = permissionIdByName.get("estoque:visualizar");
    const fiscalPermissionId = permissionIdByName.get("financeiro:notas_fiscais");
    const salesPermissionId = permissionIdByName.get("vendas:visualizar");
    for (const link of permissionLinks) {
      if (link.permissaoid === financePermissionId) financeProfiles.add(link.perfilid);
      if (link.permissaoid === stockPermissionId) stockProfiles.add(link.perfilid);
      if (link.permissaoid === fiscalPermissionId) fiscalProfiles.add(link.perfilid);
      if (link.permissaoid === salesPermissionId) salesProfiles.add(link.perfilid);
    }

    const users = (usersResult.data ?? []).map((user) => ({
      id: String(user.id),
      name: String(user.nome ?? ""),
      email: String(user.email ?? ""),
      active: user.ativo !== false,
      financialAccess: financeProfiles.has(Number(user.perfilid)),
      stockAccess: stockProfiles.has(Number(user.perfilid)),
      fiscalAccess: fiscalProfiles.has(Number(user.perfilid)),
      marketplaceAccess: salesProfiles.has(Number(user.perfilid)),
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
      notifyReceivableDaily: row.notificar_receber_diario === true,
      receivableSummaryTime: String(row.horario_resumo_receber ?? "08:00").slice(0, 5),
      receivableIncludeOverdue: row.receber_incluir_vencidas !== false,
      receivableSendWhenEmpty: row.receber_enviar_sem_contas === true,
      selectedStockEvents: Array.isArray(row.estoque_eventos_selecionados) ? row.estoque_eventos_selecionados : [],
      selectedFiscalEvents: Array.isArray(row.fiscal_eventos_selecionados) ? row.fiscal_eventos_selecionados : [],
      notifyMarketplace: row.notificar_marketplace === true,
      selectedFinanceiroEvents: Array.isArray(row.financeiro_eventos_selecionados) ? row.financeiro_eventos_selecionados : [],
      financeiroMinimumValue: Number(row.financeiro_valor_minimo ?? 0),
      selectedFinanceiroOrigins: Array.isArray(row.financeiro_origens_selecionadas) ? row.financeiro_origens_selecionadas : [],
      selectedFinanceiroBanks: Array.isArray(row.financeiro_bancos_selecionados)
        ? row.financeiro_bancos_selecionados.map((id: unknown) => Number(id))
        : [],
      lastError: row.ultimo_erro ? String(row.ultimo_erro) : null,
    }));
    return NextResponse.json({ users, recipients, banks });
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

    if ((parsed.data.notificarFinanceiroDiario
      || parsed.data.notificarReceberDiario
      || parsed.data.financeiroEventosSelecionados.length > 0)
      && !(await userHasPermission(parsed.data.usuarioId, "financeiro:visualizar"))) {
      return NextResponse.json({ error: "O usuário precisa ter acesso ao Financeiro para receber esses avisos." }, { status: 400 });
    }
    if (parsed.data.estoqueEventosSelecionados.length > 0 && !(await userHasPermission(parsed.data.usuarioId, "estoque:visualizar"))) {
      return NextResponse.json({ error: "O usuário precisa ter acesso ao Estoque para receber essas movimentações." }, { status: 400 });
    }
    if (parsed.data.fiscalEventosSelecionados.length > 0 && !(await userHasPermission(parsed.data.usuarioId, "financeiro:notas_fiscais"))) {
      return NextResponse.json({ error: "O usuário precisa ter acesso às Notas fiscais para receber esses avisos." }, { status: 400 });
    }
    if (parsed.data.notificarMarketplace && !(await userHasPermission(parsed.data.usuarioId, "vendas:visualizar"))) {
      return NextResponse.json({ error: "O usuário precisa ter acesso a Vendas para receber avisos do Marketplace." }, { status: 400 });
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
      notificar_receber_diario: parsed.data.notificarReceberDiario,
      horario_resumo_receber: parsed.data.horarioResumoReceber,
      receber_incluir_vencidas: parsed.data.receberIncluirVencidas,
      receber_enviar_sem_contas: parsed.data.receberEnviarSemContas,
      estoque_eventos_selecionados: Array.from(new Set(parsed.data.estoqueEventosSelecionados)),
      fiscal_eventos_selecionados: Array.from(new Set(parsed.data.fiscalEventosSelecionados)),
      notificar_marketplace: parsed.data.notificarMarketplace,
      financeiro_eventos_selecionados: Array.from(new Set(parsed.data.financeiroEventosSelecionados)),
      financeiro_valor_minimo: parsed.data.financeiroValorMinimo,
      financeiro_origens_selecionadas: Array.from(new Set(parsed.data.financeiroOrigensSelecionadas)),
      financeiro_bancos_selecionados: Array.from(new Set(parsed.data.financeiroBancosSelecionados)),
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
      supabaseAdmin.from("telegram_estoque_entrega").update({ status: "DESCARTADO", updated_at: now }).eq("usuario_id", usuarioId).in("status", ["PENDENTE", "ENVIANDO", "ERRO"]),
      supabaseAdmin.from("telegram_fiscal_entrega").update({ status: "DESCARTADO", updated_at: now }).eq("usuario_id", usuarioId).in("status", ["PENDENTE", "ENVIANDO", "ERRO"]),
      supabaseAdmin.from("telegram_financeiro_entrega").update({ status: "DESCARTADO", updated_at: now }).eq("usuario_id", usuarioId).in("status", ["PENDENTE", "ENVIANDO", "ERRO"]),
      // Resumo diário ainda não enviado morre junto: sem preferência, o
      // processador não teria de onde ler o chat e a linha ficaria tentando.
      supabaseAdmin.from("telegram_resumo_financeiro_envio").update({ status: "SEM_MOVIMENTO", updated_at: now }).eq("usuario_id", usuarioId).in("status", ["PENDENTE", "PROCESSANDO", "ERRO"]),
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
