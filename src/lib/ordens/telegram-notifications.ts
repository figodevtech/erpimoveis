import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  escapeTelegramHtml,
  getTelegramEnvironment,
  sendTelegramMessage,
  TelegramApiError,
} from "@/lib/integrations/telegram";
import { eventMatchesPreference } from "@/lib/ordens/telegram-notification-rules";

const STATUS_LABELS: Record<string, string> = {
  AGUARDANDO_CHECKLIST: "Aguardando checklist",
  ORCAMENTO: "Orçamento",
  APROVACAO_ORCAMENTO: "Aguardando aprovação",
  ORCAMENTO_APROVADO: "Orçamento aprovado",
  ORCAMENTO_RECUSADO: "Orçamento recusado",
  EM_ANDAMENTO: "Em andamento",
  PAGAMENTO: "Aguardando pagamento",
  SEM_COBRANCA: "Finalizada sem cobrança",
  CONCLUIDO: "Concluída",
  CANCELADO: "Cancelada",
};

const RETRY_MINUTES = [1, 5, 15, 60, 180];

type NotificationEvent = {
  id: number;
  ordemservico_id: number;
  tipo: "CRIADA" | "STATUS_ALTERADO";
  status_anterior: string | null;
  status_novo: string;
  ator_usuario_id: string | null;
  snapshot: Record<string, unknown>;
  tentativas: number;
};

type Delivery = {
  id: number;
  evento_id: number;
  usuario_id: string;
  chat_id: number;
  tentativas: number;
};

type Preference = {
  usuario_id: string;
  chat_id: number;
  modo: "CRIACAO" | "CRIACAO_FINALIZACAO" | "TODOS" | "PERSONALIZADO";
  escopo: "TODAS" | "MINHAS" | "MEU_SETOR";
  notificar_criacao: boolean;
  status_selecionados: string[];
  usuario: { ativo: boolean; setorid: number | null } | Array<{ ativo: boolean; setorid: number | null }>;
};

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function getEligiblePreferences(event: NotificationEvent) {
  const { data, error } = await supabaseAdmin
    .from("telegram_usuario_preferencia")
    .select("usuario_id, chat_id, modo, escopo, notificar_criacao, status_selecionados, usuario:usuario_id(ativo, setorid)")
    .eq("ativo", true)
    .not("chat_id", "is", null);
  if (error) throw error;

  const preferences = (data ?? []) as unknown as Preference[];
  const ownScopeIds = preferences
    .filter((preference) => preference.escopo === "MINHAS")
    .map((preference) => preference.usuario_id);
  const assignedUsers = new Set<string>();
  if (ownScopeIds.length > 0) {
    const { data: assignments, error: assignmentError } = await supabaseAdmin
      .from("osservico_realizador")
      .select("usuarioid")
      .eq("ordemservicoid", event.ordemservico_id)
      .in("usuarioid", ownScopeIds);
    if (assignmentError) throw assignmentError;
    for (const assignment of assignments ?? []) assignedUsers.add(String(assignment.usuarioid));
  }

  const creatorId = String(event.snapshot?.usuario_criador_id ?? "");
  const orderSectorId = Number(event.snapshot?.setor_id ?? 0) || null;
  return preferences.filter((preference) => {
    const user = relationOne(preference.usuario);
    if (!user?.ativo || !eventMatchesPreference(event, preference)) return false;
    if (preference.escopo === "TODAS") return true;
    if (preference.escopo === "MEU_SETOR") return Boolean(user.setorid && user.setorid === orderSectorId);
    return preference.usuario_id === creatorId || assignedUsers.has(preference.usuario_id);
  });
}

async function fanOutEvent(event: NotificationEvent) {
  const preferences = await getEligiblePreferences(event);
  if (preferences.length > 0) {
    const { error } = await supabaseAdmin.from("os_notificacao_entrega").upsert(
      preferences.map((preference) => ({
        evento_id: event.id,
        usuario_id: preference.usuario_id,
        chat_id: preference.chat_id,
      })),
      { onConflict: "evento_id,usuario_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  }
  const { error } = await supabaseAdmin
    .from("os_notificacao_evento")
    .update({ status_processamento: "PROCESSADO", locked_at: null, processado_em: new Date().toISOString() })
    .eq("id", event.id);
  if (error) throw error;
  return preferences.length;
}

async function failEvent(event: NotificationEvent, failure: unknown) {
  const message = String(failure instanceof Error ? failure.message : failure).slice(0, 1000);
  const exhausted = event.tentativas >= 5;
  const retryMinutes = RETRY_MINUTES[Math.min(Math.max(event.tentativas - 1, 0), RETRY_MINUTES.length - 1)];
  await supabaseAdmin
    .from("os_notificacao_evento")
    .update({
      status_processamento: "ERRO",
      locked_at: null,
      ultimo_erro: message,
      disponivel_em: exhausted ? new Date("9999-12-31").toISOString() : new Date(Date.now() + retryMinutes * 60_000).toISOString(),
    })
    .eq("id", event.id);
}

async function getMessageData(delivery: Delivery) {
  const { data: event, error: eventError } = await supabaseAdmin
    .from("os_notificacao_evento")
    .select("id, ordemservico_id, tipo, status_anterior, status_novo, ator_usuario_id")
    .eq("id", delivery.evento_id)
    .single();
  if (eventError) throw eventError;

  const { data: order, error: orderError } = await supabaseAdmin
    .from("ordemservico")
    .select(`
      id, prioridade, alvo_tipo, equipamento_nome,
      cliente:clienteid(nomerazaosocial),
      veiculo:veiculoid(placa, marca, modelo),
      peca:pecaid(titulo),
      setor:setorid(nome),
      criador:usuariocriadorid(nome)
    `)
    .eq("id", event.ordemservico_id)
    .single();
  if (orderError) throw orderError;

  let actorName: string | null = null;
  if (event.ator_usuario_id) {
    const { data: actor } = await supabaseAdmin.from("usuario").select("nome").eq("id", event.ator_usuario_id).maybeSingle();
    actorName = actor?.nome ?? null;
  }
  return { event, order, actorName };
}

function orderTarget(order: Record<string, unknown>) {
  const vehicle = relationOne(order.veiculo as Record<string, unknown> | Record<string, unknown>[] | null);
  if (vehicle) return `${vehicle.placa ?? "Sem placa"} — ${[vehicle.marca, vehicle.modelo].filter(Boolean).join(" ")}`;
  const part = relationOne(order.peca as Record<string, unknown> | Record<string, unknown>[] | null);
  if (part) return String(part.titulo ?? "Peça");
  return String(order.equipamento_nome ?? "Equipamento");
}

function buildMessage(data: Awaited<ReturnType<typeof getMessageData>>) {
  const { event, order, actorName } = data;
  const client = relationOne(order.cliente as { nomerazaosocial?: string } | Array<{ nomerazaosocial?: string }> | null);
  const sector = relationOne(order.setor as { nome?: string } | Array<{ nome?: string }> | null);
  const creator = relationOne(order.criador as { nome?: string } | Array<{ nome?: string }> | null);
  const lines = event.tipo === "CRIADA"
    ? [
        `🔧 <b>Nova ordem de serviço #${order.id}</b>`,
        "",
        `<b>Cliente:</b> ${escapeTelegramHtml(client?.nomerazaosocial ?? "Não informado")}`,
        `<b>Alvo:</b> ${escapeTelegramHtml(orderTarget(order as Record<string, unknown>))}`,
        `<b>Setor:</b> ${escapeTelegramHtml(sector?.nome ?? "Não informado")}`,
        `<b>Prioridade:</b> ${escapeTelegramHtml(order.prioridade ?? "Normal")}`,
        `<b>Criada por:</b> ${escapeTelegramHtml(creator?.nome ?? actorName ?? "Sistema")}`,
        `<b>Status:</b> ${escapeTelegramHtml(STATUS_LABELS[event.status_novo] ?? event.status_novo)}`,
      ]
    : [
        `🔄 <b>OS #${order.id} atualizada</b>`,
        "",
        `<b>Cliente:</b> ${escapeTelegramHtml(client?.nomerazaosocial ?? "Não informado")}`,
        `<b>Alvo:</b> ${escapeTelegramHtml(orderTarget(order as Record<string, unknown>))}`,
        `<b>De:</b> ${escapeTelegramHtml(STATUS_LABELS[event.status_anterior ?? ""] ?? event.status_anterior ?? "—")}`,
        `<b>Para:</b> ${escapeTelegramHtml(STATUS_LABELS[event.status_novo] ?? event.status_novo)}`,
        `<b>Alterada por:</b> ${escapeTelegramHtml(actorName ?? "Sistema")}`,
      ];
  return lines.join("\n").slice(0, 4000);
}

async function completeDelivery(delivery: Delivery, telegramMessageId: number) {
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("os_notificacao_entrega")
    .update({ status: "ENVIADO", telegram_message_id: telegramMessageId, sent_at: now, locked_at: null, updated_at: now })
    .eq("id", delivery.id);
}

async function failDelivery(delivery: Delivery, failure: unknown) {
  const apiError = failure instanceof TelegramApiError ? failure : null;
  const permanent = apiError?.isPermanent ?? false;
  const exhausted = delivery.tentativas >= 5;
  const retryMinutes = RETRY_MINUTES[Math.min(Math.max(delivery.tentativas - 1, 0), RETRY_MINUTES.length - 1)];
  const retryMs = (apiError?.retryAfterSeconds ?? retryMinutes * 60) * 1000;
  const now = new Date().toISOString();
  const message = String(failure instanceof Error ? failure.message : failure).slice(0, 1000);
  await supabaseAdmin
    .from("os_notificacao_entrega")
    .update({
      status: permanent || exhausted ? "DESCARTADO" : "ERRO",
      next_retry_at: permanent || exhausted ? null : new Date(Date.now() + retryMs).toISOString(),
      locked_at: null,
      erro_codigo: apiError ? String(apiError.errorCode) : "INTERNAL",
      erro_mensagem: message,
      updated_at: now,
    })
    .eq("id", delivery.id);
  if (permanent && [400, 403].includes(apiError?.errorCode ?? 0)) {
    await supabaseAdmin
      .from("telegram_usuario_preferencia")
      .update({ ultimo_erro: message, updated_at: now })
      .eq("usuario_id", delivery.usuario_id);
  }
}

export async function processTelegramNotifications(params: { eventLimit?: number; deliveryLimit?: number } = {}) {
  const environment = getTelegramEnvironment();
  if (!environment.enabled) return { skipped: true, reason: "Integração desativada", events: 0, deliveries: 0, sent: 0, failed: 0 };
  if (!environment.configured) throw new Error("Telegram não está configurado por completo.");

  const { data: events, error: eventError } = await supabaseAdmin.rpc("fn_reservar_eventos_notificacao_os", {
    p_limit: params.eventLimit ?? 30,
  });
  if (eventError) throw eventError;

  let createdDeliveries = 0;
  for (const event of (events ?? []) as NotificationEvent[]) {
    try {
      createdDeliveries += await fanOutEvent(event);
    } catch (error) {
      await failEvent(event, error);
    }
  }

  const { data: deliveries, error: deliveryError } = await supabaseAdmin.rpc("fn_reservar_entregas_notificacao_os", {
    p_limit: params.deliveryLimit ?? 50,
  });
  if (deliveryError) throw deliveryError;

  let sent = 0;
  let failed = 0;
  for (const delivery of (deliveries ?? []) as Delivery[]) {
    try {
      const data = await getMessageData(delivery);
      const message = await sendTelegramMessage({
        chatId: delivery.chat_id,
        text: buildMessage(data),
        buttonUrl: environment.appUrl ? `${environment.appUrl}/ordens?q=${data.order.id}` : undefined,
      });
      await completeDelivery(delivery, message.message_id);
      sent += 1;
    } catch (error) {
      await failDelivery(delivery, error);
      failed += 1;
    }
  }

  return {
    skipped: false,
    events: events?.length ?? 0,
    deliveries: createdDeliveries,
    processedDeliveries: deliveries?.length ?? 0,
    sent,
    failed,
  };
}

export { STATUS_LABELS };
