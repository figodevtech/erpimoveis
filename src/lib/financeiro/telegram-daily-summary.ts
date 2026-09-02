import {
  buildFinancialSummaryMessages,
  financialSummaryWording,
  financialTransactionDateKey,
  financialTransactionValue,
  fortalezaDateTime,
  type FinancialSummaryKind,
  type FinancialTransaction,
} from "@/lib/financeiro/telegram-daily-summary-format";
import { getTelegramEnvironment, sendTelegramMessage, TelegramApiError } from "@/lib/integrations/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const RETRY_MINUTES = [1, 5, 15, 60, 180];

const SUMMARY_KINDS: FinancialSummaryKind[] = ["A_PAGAR", "A_RECEBER"];

const PREFERENCE_COLUMNS =
  "chat_id, financeiro_incluir_atrasadas, financeiro_enviar_sem_contas, receber_incluir_vencidas, receber_enviar_sem_contas";

type ReservedSummary = {
  id: number;
  usuario_id: string;
  referencia_data: string;
  tipo: FinancialSummaryKind;
  tentativas: number;
  mensagens: string[] | null;
  proxima_mensagem: number;
  telegram_message_ids: number[];
};

type FinancialPreference = {
  chat_id: number;
  financeiro_incluir_atrasadas: boolean;
  financeiro_enviar_sem_contas: boolean;
  receber_incluir_vencidas: boolean;
  receber_enviar_sem_contas: boolean;
};

/**
 * Cada resumo lê as suas próprias opções: o de contas a pagar decide se leva as
 * atrasadas, o de contas a receber se leva as vencidas.
 */
function summarySettings(preference: FinancialPreference, kind: FinancialSummaryKind) {
  return kind === "A_RECEBER"
    ? {
        includeOverdue: preference.receber_incluir_vencidas !== false,
        sendWhenEmpty: preference.receber_enviar_sem_contas === true,
      }
    : {
        includeOverdue: preference.financeiro_incluir_atrasadas !== false,
        sendWhenEmpty: preference.financeiro_enviar_sem_contas === true,
      };
}

function summaryLink(kind: FinancialSummaryKind, appUrl: string, isLastMessage: boolean) {
  const wording = financialSummaryWording(kind);
  return {
    buttonUrl: isLastMessage && appUrl ? `${appUrl}/fluxodecaixa?view=${wording.viewMode}` : undefined,
    buttonLabel: wording.buttonLabel,
  };
}


async function loadTransactions(
  referenceDate: string,
  includeOverdue: boolean,
  kind: FinancialSummaryKind = "A_PAGAR",
) {
  const start = new Date(`${referenceDate}T00:00:00-03:00`).toISOString();
  const end = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const rows: FinancialTransaction[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabaseAdmin
      .from("transacao")
      .select('id, descricao, valor, "valorLiquido", valor_descontos, valor_baixado, pendente, tipo, data, categoria, ordemservicoid, vendaid, nomepagador, cpfcnpjpagador, fornecedor:fornecedor_id(nomerazaosocial, nomefantasia)')
      .eq("is_deleted", false)
      .eq("pendente", true)
      .eq("tipo", financialSummaryWording(kind).transactionType)
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
    .select(PREFERENCE_COLUMNS)
    .eq("usuario_id", summary.usuario_id)
    .single();
  if (preferenceError) throw preferenceError;
  const settings = preference as FinancialPreference;
  const kind: FinancialSummaryKind = summary.tipo === "A_RECEBER" ? "A_RECEBER" : "A_PAGAR";
  const { includeOverdue, sendWhenEmpty } = summarySettings(settings, kind);

  let messages = Array.isArray(summary.mensagens) ? summary.mensagens : null;
  if (!messages) {
    const transactions = await loadTransactions(summary.referencia_data, includeOverdue, kind);
    if (transactions.length === 0 && !sendWhenEmpty) {
      await supabaseAdmin.from("telegram_resumo_financeiro_envio").update({
        status: "SEM_MOVIMENTO", locked_at: null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", summary.id);
      return { sent: 0, empty: 1 };
    }
    messages = buildFinancialSummaryMessages(summary.referencia_data, transactions, kind);
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
      ...summaryLink(kind, environment.appUrl, index === messages.length - 1),
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

  let summaries = 0;
  let sent = 0;
  let empty = 0;
  let failed = 0;
  // Os dois resumos são reservados separadamente: cada um tem o seu horário, e
  // um deles pode estar na hora enquanto o outro ainda não chegou.
  for (const kind of SUMMARY_KINDS) {
    const { data, error } = await supabaseAdmin.rpc("fn_reservar_resumos_financeiros_telegram", {
      p_referencia_data: local.date,
      p_horario_local: local.time,
      p_limit: 20,
      p_tipo: kind,
    });
    if (error) throw error;

    summaries += data?.length ?? 0;
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
  }
  return { skipped: false, summaries, sent, empty, failed };
}

export async function sendFinancialSummaryTest(
  usuarioId: string,
  kind: FinancialSummaryKind = "A_PAGAR",
  now = new Date(),
) {
  const local = fortalezaDateTime(now);
  const [{ data: preference, error }, { data: target, error: targetError }, { data: permission, error: permissionError }] = await Promise.all([
    supabaseAdmin
    .from("telegram_usuario_preferencia")
    .select(`${PREFERENCE_COLUMNS}, notificar_financeiro_diario, notificar_receber_diario`)
    .eq("usuario_id", usuarioId)
    .single(),
    supabaseAdmin.from("usuario").select("perfilid, ativo").eq("id", usuarioId).single(),
    supabaseAdmin.from("permissao").select("id").ilike("nome", "financeiro:visualizar").maybeSingle(),
  ]);
  if (error || targetError || permissionError) throw error ?? targetError ?? permissionError;
  const enabled = kind === "A_RECEBER"
    ? preference.notificar_receber_diario
    : preference.notificar_financeiro_diario;
  if (!target.ativo || !enabled) {
    const label = financialSummaryWording(kind).title.toLocaleLowerCase("pt-BR");
    throw new Error(`O resumo de ${label} não está ativo para este destinatário.`);
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
  const { includeOverdue } = summarySettings(preference as FinancialPreference, kind);
  const transactions = await loadTransactions(local.date, includeOverdue, kind);
  const messages = buildFinancialSummaryMessages(local.date, transactions, kind);
  const environment = getTelegramEnvironment();
  for (let index = 0; index < messages.length; index += 1) {
    await sendTelegramMessage({
      chatId: preference.chat_id,
      text: `<i>Teste do resumo de ${financialSummaryWording(kind).title.toLocaleLowerCase("pt-BR")}</i>\n\n${messages[index]}`,
      ...summaryLink(kind, environment.appUrl, index === messages.length - 1),
    });
  }
  return { messages: messages.length, transactions: transactions.length };
}
