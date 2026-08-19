import {
  buildFinancialSummaryMessages,
  financialTransactionDateKey,
  financialTransactionValue,
  fortalezaDateTime,
  type FinancialTransaction,
} from "@/lib/financeiro/telegram-daily-summary-format";
import { getTelegramEnvironment, sendTelegramMessage, TelegramApiError } from "@/lib/integrations/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const RETRY_MINUTES = [1, 5, 15, 60, 180];

type ReservedSummary = {
  id: number;
  usuario_id: string;
  referencia_data: string;
  tentativas: number;
  mensagens: string[] | null;
  proxima_mensagem: number;
  telegram_message_ids: number[];
};

type FinancialPreference = {
  chat_id: number;
  financeiro_incluir_atrasadas: boolean;
  financeiro_enviar_sem_contas: boolean;
};


async function loadTransactions(referenceDate: string, includeOverdue: boolean) {
  const start = new Date(`${referenceDate}T00:00:00-03:00`).toISOString();
  const end = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const rows: FinancialTransaction[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabaseAdmin
      .from("transacao")
      .select('id, descricao, valor, "valorLiquido", valor_descontos, valor_baixado, pendente, tipo, data, categoria, ordemservicoid, vendaid, fornecedor:fornecedor_id(nomerazaosocial, nomefantasia)')
      .eq("is_deleted", false)
      .eq("pendente", true)
      .eq("tipo", "DESPESA")
      .lt("data", end)
      .order("data", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (!includeOverdue) query = query.gte("data", start);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as FinancialTransaction[]));
    if ((data?.length ?? 0) < 1000) break;
  }
  return rows;
}

async function markFailure(summary: ReservedSummary, failure: unknown) {
  const apiError = failure instanceof TelegramApiError ? failure : null;
  const retryMinutes = RETRY_MINUTES[Math.min(Math.max(summary.tentativas - 1, 0), RETRY_MINUTES.length - 1)];
  const retryMs = (apiError?.retryAfterSeconds ?? retryMinutes * 60) * 1000;
  await supabaseAdmin.from("telegram_resumo_financeiro_envio").update({
    status: "ERRO",
    locked_at: null,
    erro: String(failure instanceof Error ? failure.message : failure).slice(0, 1000),
    proxima_tentativa_em: new Date(Date.now() + retryMs).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", summary.id);
}

async function processSummary(summary: ReservedSummary) {
  const { data: preference, error: preferenceError } = await supabaseAdmin
    .from("telegram_usuario_preferencia")
    .select("chat_id, financeiro_incluir_atrasadas, financeiro_enviar_sem_contas")
    .eq("usuario_id", summary.usuario_id)
    .single();
  if (preferenceError) throw preferenceError;
  const settings = preference as FinancialPreference;

  let messages = Array.isArray(summary.mensagens) ? summary.mensagens : null;
  if (!messages) {
    const transactions = await loadTransactions(summary.referencia_data, settings.financeiro_incluir_atrasadas);
    if (transactions.length === 0 && !settings.financeiro_enviar_sem_contas) {
      await supabaseAdmin.from("telegram_resumo_financeiro_envio").update({
        status: "SEM_MOVIMENTO", locked_at: null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", summary.id);
      return { sent: 0, empty: 1 };
    }
    messages = buildFinancialSummaryMessages(summary.referencia_data, transactions);
    const overdue = transactions.filter((item) => financialTransactionDateKey(item.data) < summary.referencia_data);
    const today = transactions.filter((item) => financialTransactionDateKey(item.data) === summary.referencia_data);
    const { error } = await supabaseAdmin.from("telegram_resumo_financeiro_envio").update({
      mensagens: messages,
      quantidade_atrasadas: overdue.length,
      quantidade_hoje: today.length,
      total_atrasado: overdue.reduce((total, item) => total + financialTransactionValue(item), 0),
      total_hoje: today.reduce((total, item) => total + financialTransactionValue(item), 0),
      updated_at: new Date().toISOString(),
    }).eq("id", summary.id);
    if (error) throw error;
  }

  const environment = getTelegramEnvironment();
  const messageIds = Array.isArray(summary.telegram_message_ids) ? [...summary.telegram_message_ids] : [];
  for (let index = summary.proxima_mensagem ?? 0; index < messages.length; index += 1) {
    const sent = await sendTelegramMessage({
      chatId: settings.chat_id,
      text: messages[index],
      buttonUrl: index === messages.length - 1 && environment.appUrl ? `${environment.appUrl}/fluxodecaixa?view=A_PAGAR` : undefined,
      buttonLabel: "Abrir contas a pagar",
    });
    messageIds.push(sent.message_id);
    const { error } = await supabaseAdmin.from("telegram_resumo_financeiro_envio").update({
      proxima_mensagem: index + 1,
      telegram_message_ids: messageIds,
      updated_at: new Date().toISOString(),
    }).eq("id", summary.id);
    if (error) throw error;
  }

  await supabaseAdmin.from("telegram_resumo_financeiro_envio").update({
    status: "ENVIADO", locked_at: null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", summary.id);
  return { sent: messages.length, empty: 0 };
}

export async function processDailyFinancialSummaries(now = new Date()) {
  const environment = getTelegramEnvironment();
  if (!environment.enabled) return { skipped: true, summaries: 0, sent: 0, empty: 0, failed: 0 };
  if (!environment.configured) throw new Error("Telegram não está configurado por completo.");
  const local = fortalezaDateTime(now);
  const { data, error } = await supabaseAdmin.rpc("fn_reservar_resumos_financeiros_telegram", {
    p_referencia_data: local.date,
    p_horario_local: local.time,
    p_limit: 20,
  });
  if (error) throw error;

  let sent = 0;
  let empty = 0;
  let failed = 0;
  for (const summary of (data ?? []) as ReservedSummary[]) {
    try {
      const result = await processSummary(summary);
      sent += result.sent;
      empty += result.empty;
    } catch (failure) {
      await markFailure(summary, failure);
      failed += 1;
    }
  }
  return { skipped: false, summaries: data?.length ?? 0, sent, empty, failed };
}

export async function sendFinancialSummaryTest(usuarioId: string, now = new Date()) {
  const local = fortalezaDateTime(now);
  const [{ data: preference, error }, { data: target, error: targetError }, { data: permission, error: permissionError }] = await Promise.all([
    supabaseAdmin
    .from("telegram_usuario_preferencia")
    .select("chat_id, financeiro_incluir_atrasadas, notificar_financeiro_diario")
    .eq("usuario_id", usuarioId)
    .single(),
    supabaseAdmin.from("usuario").select("perfilid, ativo").eq("id", usuarioId).single(),
    supabaseAdmin.from("permissao").select("id").ilike("nome", "financeiro:visualizar").maybeSingle(),
  ]);
  if (error || targetError || permissionError) throw error ?? targetError ?? permissionError;
  if (!target.ativo || !preference.notificar_financeiro_diario) {
    throw new Error("O resumo financeiro não está ativo para este destinatário.");
  }
  const { data: permissionLink, error: permissionLinkError } = await supabaseAdmin
    .from("perfilpermissao")
    .select("perfilid")
    .eq("perfilid", target.perfilid)
    .eq("permissaoid", permission?.id ?? -1)
    .maybeSingle();
  if (permissionLinkError) throw permissionLinkError;
  if (!permissionLink) throw new Error("O destinatário não possui acesso ao Financeiro.");
  if (!preference.chat_id) throw new Error("Destinatário ainda não vinculado ao Telegram.");
  const transactions = await loadTransactions(local.date, preference.financeiro_incluir_atrasadas !== false);
  const messages = buildFinancialSummaryMessages(local.date, transactions);
  const environment = getTelegramEnvironment();
  for (let index = 0; index < messages.length; index += 1) {
    await sendTelegramMessage({
      chatId: preference.chat_id,
      text: `<i>Teste do resumo financeiro</i>\n\n${messages[index]}`,
      buttonUrl: index === messages.length - 1 && environment.appUrl ? `${environment.appUrl}/fluxodecaixa?view=A_PAGAR` : undefined,
      buttonLabel: "Abrir contas a pagar",
    });
  }
  return { messages: messages.length, transactions: transactions.length };
}
