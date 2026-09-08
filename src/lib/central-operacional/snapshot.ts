import "server-only";

import { saldoEmAberto } from "@/lib/financeiro/transacao";
import { fetchAllSupabaseRows } from "@/lib/supabase-pagination";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  COMPLETED_ORDER_STATUSES,
  dateFallsWithinPeriod,
  summarizeCashFlow,
  summarizeCompletedOrders,
} from "./aggregates";
import {
  isOperationalEventEligibleForGlobalAttention,
  overdueAccountAttentionCopy,
} from "./attention-rules";
import {
  OPERATIONAL_MODULES,
  OPERATIONAL_EVENT_MODULES,
  operationalEventSchema,
  operationalSnapshotSchema,
  type OperationalAttention,
  type OperationalEvent,
  type OperationalModule,
  type OperationalNode,
  type OperationalNodeModule,
  type OperationalPeriod,
  type OperationalSnapshot,
} from "./contracts";
import { operationalPeriodWindow, type OperationalPeriodWindow } from "./period";
import { resolveOperationalTenant } from "./tenant";

type EventRow = {
  id: string;
  tipo: string;
  modulo: string;
  entidade_tipo: string;
  entidade_id: string | null;
  titulo: string;
  descricao: string | null;
  valor: number | string | null;
  quantidade: number | string | null;
  prioridade: string;
  metadata: unknown;
  ocorrido_em: string;
};
type VendaRow = { id: number; status: string; valortotal: number | string | null; datavenda: string | null };
type OrderResultRow = {
  id: number;
  status: string;
  orcamentototal: number | string | null;
  execucao_fim_em: string | null;
};
type FinanceRow = {
  id: number;
  tipo: string;
  valor: number | string | null;
  valorLiquido: number | string | null;
  valor_descontos: number | string | null;
  valor_baixado: number | string | null;
  pendente: boolean;
  banco_id: number | null;
  data: string;
};
type ClientNameRow = { nomerazaosocial: string | null };
type AccountRow = FinanceRow & {
  vencimento_em: string | null;
  descricao: string | null;
  adiantamento_id: number | null;
  cliente: ClientNameRow | ClientNameRow[] | null;
};
type FiscalRow = { id: number; status: string; numero: string | number | null; data: string };

const ACTIVE_ORDER_STATUSES = [
  "ORCAMENTO",
  "APROVACAO_ORCAMENTO",
  "ORCAMENTO_APROVADO",
  "EM_ANDAMENTO",
  "PAGAMENTO",
  "FATURAMENTO",
];
const CONFIRMED_SALE_STATUSES = ["PAGAMENTO", "PAGO", "FINALIZADA", "AUTORIZADO"];

function numberOrZero(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function eventFromRow(row: EventRow): OperationalEvent {
  return operationalEventSchema.parse({
    id: row.id,
    tipo: row.tipo,
    modulo: row.modulo,
    entidadeTipo: row.entidade_tipo,
    entidadeId: row.entidade_id,
    titulo: row.titulo,
    descricao: row.descricao,
    valor: row.valor === null ? null : numberOrZero(row.valor),
    quantidade: row.quantidade === null ? null : numberOrZero(row.quantidade),
    prioridade: row.prioridade,
    metadata: metadataRecord(row.metadata),
    ocorridoEm: row.ocorrido_em,
  });
}

function unavailableNode(module: OperationalNodeModule): OperationalNode {
  return {
    modulo: module,
    disponivel: false,
    estado: "SEM ACESSO",
    indicador: null,
    detalhe: "Módulo restrito pelas suas permissões",
    alerta: false,
  };
}

async function loadOrders(window: OperationalPeriodWindow) {
  const [active, completed, running] = await Promise.all([
    supabaseAdmin
      .from("ordemservico")
      .select("id", { count: "exact", head: true })
      .in("status", ACTIVE_ORDER_STATUSES)
      .eq("is_deleted", false)
      .is("migracao_referencia", null),
    fetchAllSupabaseRows<OrderResultRow>(() =>
      supabaseAdmin
        .from("ordemservico")
        .select("id, status, orcamentototal, execucao_fim_em")
        .in("status", [...COMPLETED_ORDER_STATUSES])
        .gte("execucao_fim_em", window.start)
        .lt("execucao_fim_em", window.end)
        .eq("is_deleted", false)
        .is("migracao_referencia", null)
        .order("execucao_fim_em", { ascending: false }),
    ),
    supabaseAdmin
      .from("ordemservico")
      .select("id, execucao_inicio_em, dataentrada")
      .eq("status", "EM_ANDAMENTO")
      .eq("is_deleted", false)
      .is("migracao_referencia", null)
      .order("execucao_inicio_em", { ascending: true, nullsFirst: false })
      .limit(8),
  ]);
  if (active.error) throw active.error;
  if (running.error) throw running.error;

  const now = Date.now();
  const attentions: OperationalAttention[] = (running.data ?? []).flatMap((row) => {
    const startedAt = row.execucao_inicio_em ?? row.dataentrada;
    if (!startedAt) return [];
    const elapsed = now - new Date(startedAt).getTime();
    if (elapsed < 2 * 60 * 60 * 1_000) return [];
    const hours = Math.floor(elapsed / 3_600_000);
    const minutes = Math.floor((elapsed % 3_600_000) / 60_000);
    return [{
      id: `os-tempo-${row.id}`,
      modulo: "ORDENS" as const,
      titulo: `OS #${row.id} em execução`,
      detalhe: `${hours}h${String(minutes).padStart(2, "0")} em andamento`,
      prioridade: hours >= 6 ? "CRITICO" as const : "ATENCAO" as const,
      valor: null,
      ocorridoEm: new Date(startedAt).toISOString(),
    }];
  });

  const completedSummary = summarizeCompletedOrders(completed);

  return {
    active: active.count ?? 0,
    node: {
      modulo: "ORDENS" as const,
      disponivel: true,
      estado: attentions.some((item) => item.prioridade === "CRITICO") ? "ATENÇÃO" : "OPERACIONAL",
      indicador: { tipo: "MOEDA" as const, valor: completedSummary.total, sufixo: null },
      detalhe: `${completedSummary.count} concluídas ${window.detailLabel}`,
      alerta: attentions.length > 0,
    },
    attentions,
  };
}

async function loadSales(window: OperationalPeriodWindow) {
  const rows = await fetchAllSupabaseRows<VendaRow>(() =>
    supabaseAdmin
      .from("venda")
      .select("id, status, valortotal, datavenda")
      .in("status", CONFIRMED_SALE_STATUSES)
      .gte("datavenda", window.start)
      .lt("datavenda", window.end)
      .order("datavenda", { ascending: false }),
  );
  const total = rows.reduce((sum, row) => sum + numberOrZero(row.valortotal), 0);
  return {
    modulo: "VENDAS" as const,
    disponivel: true,
    estado: "OPERACIONAL",
    indicador: { tipo: "MOEDA" as const, valor: total, sufixo: null },
    detalhe: `${rows.length} confirmadas ${window.detailLabel}`,
    alerta: false,
  };
}

async function loadFinance(window: OperationalPeriodWindow) {
  const rows = await fetchAllSupabaseRows<FinanceRow>(() =>
    supabaseAdmin
      .from("transacao")
      .select("id, tipo, valor, valorLiquido, valor_descontos, valor_baixado, pendente, banco_id, data")
      .eq("is_deleted", false)
      .eq("pendente", false)
      .gte("data", window.start)
      .lt("data", window.end)
      .order("data", { ascending: false }),
  );
  const summary = summarizeCashFlow(rows);
  return {
    modulo: "FINANCEIRO" as const,
    disponivel: true,
    estado: "OPERACIONAL",
    indicador: { tipo: "MOEDA" as const, valor: summary.balance, sufixo: null },
    detalhe: `${summary.entryCount} entradas · ${summary.exitCount} saídas`,
    alerta: false,
  };
}

async function loadAccounts(window: OperationalPeriodWindow, nowIso: string) {
  const rows = await fetchAllSupabaseRows<AccountRow>(() =>
    supabaseAdmin
      .from("transacao")
      .select(`
        id, tipo, valor, valorLiquido, valor_descontos, valor_baixado,
        pendente, banco_id, data, vencimento_em, descricao, adiantamento_id,
        cliente:cliente!transacao_cliente_id_fkey ( nomerazaosocial )
      `)
      .eq("is_deleted", false)
      .in("tipo", ["DESPESA", "RECEITA"])
      .eq("pendente", true)
      .order("vencimento_em", { ascending: true, nullsFirst: false }),
  );
  const eligibleRows = rows.filter((row) => row.tipo !== "RECEITA" || row.adiantamento_id === null);
  const payables = eligibleRows.filter((row) => row.tipo === "DESPESA");
  const receivables = eligibleRows.filter((row) => row.tipo === "RECEITA");
  const payablesInPeriod = payables.filter((row) => dateFallsWithinPeriod(row.vencimento_em ?? row.data, window));
  const receivablesInPeriod = receivables.filter((row) => dateFallsWithinPeriod(row.vencimento_em ?? row.data, window));
  const payableTotal = payablesInPeriod.reduce((sum, row) => sum + saldoEmAberto(row), 0);
  const receivableTotal = receivablesInPeriod.reduce((sum, row) => sum + saldoEmAberto(row), 0);
  const nowTimestamp = new Date(nowIso).getTime();
  const overdue = eligibleRows.filter((row) => Boolean(
    row.vencimento_em && new Date(row.vencimento_em).getTime() < nowTimestamp,
  ));
  const overduePayables = overdue.filter((row) => row.tipo === "DESPESA");
  const overdueReceivables = overdue.filter((row) => row.tipo === "RECEITA");
  const attentions: OperationalAttention[] = overdue.slice(0, 8).map((row) => {
    const client = Array.isArray(row.cliente) ? row.cliente[0] ?? null : row.cliente;
    const copy = overdueAccountAttentionCopy({
      id: row.id,
      tipo: row.tipo,
      descricao: row.descricao,
      clienteNome: client?.nomerazaosocial ?? null,
      vencimentoEm: row.vencimento_em ?? nowIso,
    });
    return {
      id: `conta-vencida-${row.id}`,
      modulo: row.tipo === "RECEITA" ? "CONTAS_RECEBER" : "CONTAS_PAGAR",
      titulo: copy.titulo,
      detalhe: copy.detalhe,
      prioridade: "CRITICO",
      valor: saldoEmAberto(row),
      ocorridoEm: row.vencimento_em ?? nowIso,
    };
  });

  return {
    payablesNode: {
      modulo: "CONTAS_PAGAR" as const,
      disponivel: true,
      estado: overduePayables.length ? "ATENÇÃO" : "OPERACIONAL",
      indicador: { tipo: "MOEDA" as const, valor: payableTotal, sufixo: null },
      detalhe: overduePayables.length
        ? `${overduePayables.length} vencidas · ${payablesInPeriod.length} ${window.detailLabel}`
        : `${payablesInPeriod.length} a pagar ${window.detailLabel}`,
      alerta: overduePayables.length > 0,
    },
    receivablesNode: {
      modulo: "CONTAS_RECEBER" as const,
      disponivel: true,
      estado: overdueReceivables.length ? "ATENÇÃO" : "OPERACIONAL",
      indicador: { tipo: "MOEDA" as const, valor: receivableTotal, sufixo: null },
      detalhe: overdueReceivables.length
        ? `${overdueReceivables.length} vencidas · ${receivablesInPeriod.length} ${window.detailLabel}`
        : `${receivablesInPeriod.length} a receber ${window.detailLabel}`,
      alerta: overdueReceivables.length > 0,
    },
    attentions,
  };
}

async function loadFiscal(window: OperationalPeriodWindow) {
  const [nfe, nfse] = await Promise.all([
    fetchAllSupabaseRows<{ id: number; status: string; numero: number | null; dataautorizacao: string | null; updatedat: string }>(() =>
      supabaseAdmin
        .from("nfe")
        .select("id, status, numero, dataautorizacao, updatedat")
        .eq("is_deleted", false)
        .gte("updatedat", window.start)
        .lt("updatedat", window.end)
        .order("updatedat", { ascending: false }),
    ),
    fetchAllSupabaseRows<{ id: number; status: string; numero: string | null; updatedat: string }>(() =>
      supabaseAdmin
        .from("nfse")
        .select("id, status, numero, updatedat")
        .gte("updatedat", window.start)
        .lt("updatedat", window.end)
        .order("updatedat", { ascending: false }),
    ),
  ]);
  const rows: FiscalRow[] = [
    ...nfe.map((row) => ({ id: row.id, status: row.status, numero: row.numero, data: row.updatedat })),
    ...nfse.map((row) => ({ id: row.id, status: row.status, numero: row.numero, data: row.updatedat })),
  ];
  const authorized = rows.filter((row) => ["AUTORIZADA", "AUTORIZADO", "EMITIDA", "EMITIDO"].includes(row.status.toUpperCase()));
  const rejected = rows.filter((row) => ["REJEITADA", "REJEITADO", "DENEGADA", "ERRO_AUTORIZACAO"].includes(row.status.toUpperCase()));
  return {
    modulo: "FISCAL" as const,
    disponivel: true,
    estado: rejected.length ? "ATENÇÃO" : "OPERACIONAL",
    indicador: { tipo: "CONTAGEM" as const, valor: authorized.length, sufixo: "notas" },
    detalhe: rejected.length ? `${rejected.length} rejeitadas no período` : `Documentos ${window.detailLabel}`,
    alerta: rejected.length > 0,
  };
}

export async function createOperationalSnapshot(
  permittedModules: OperationalModule[],
  period: OperationalPeriod = "DIARIO",
): Promise<OperationalSnapshot> {
  const tenant = await resolveOperationalTenant();
  const allowed = new Set(permittedModules);
  const window = operationalPeriodWindow(period);
  const nowIso = new Date().toISOString();
  const permittedEventModules = OPERATIONAL_EVENT_MODULES.filter((module) => allowed.has(module));

  const [eventsResult, eventCountResult, orders, sales, finance, accounts, fiscal] = await Promise.all([
    supabaseAdmin
      .from("central_evento_operacional")
      .select("id, tipo, modulo, entidade_tipo, entidade_id, titulo, descricao, valor, quantidade, prioridade, metadata, ocorrido_em")
      .eq("tenant_id", tenant.id)
      .in("modulo", permittedEventModules)
      .order("ocorrido_em", { ascending: false })
      .order("id", { ascending: false })
      .limit(40),
    supabaseAdmin
      .from("central_evento_operacional")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .in("modulo", permittedEventModules)
      .gte("ocorrido_em", window.start)
      .lt("ocorrido_em", window.end),
    allowed.has("ORDENS") ? loadOrders(window) : Promise.resolve(null),
    allowed.has("VENDAS") ? loadSales(window) : Promise.resolve(null),
    allowed.has("FINANCEIRO") ? loadFinance(window) : Promise.resolve(null),
    allowed.has("CONTAS_PAGAR") || allowed.has("CONTAS_RECEBER")
      ? loadAccounts(window, nowIso)
      : Promise.resolve(null),
    allowed.has("FISCAL") ? loadFiscal(window) : Promise.resolve(null),
  ]);
  if (eventsResult.error) throw eventsResult.error;
  if (eventCountResult.error) throw eventCountResult.error;

  const recentEvents = ((eventsResult.data ?? []) as EventRow[]).map(eventFromRow);
  const attentions: OperationalAttention[] = [
    ...(orders?.attentions ?? []),
    ...(accounts?.attentions ?? []),
    ...recentEvents
      .filter(isOperationalEventEligibleForGlobalAttention)
      .slice(0, 4)
      .map((event) => ({
        id: `evento-${event.id}`,
        modulo: event.modulo,
        titulo: event.titulo,
        detalhe: event.descricao,
        prioridade: event.prioridade,
        valor: event.valor,
        ocorridoEm: event.ocorridoEm,
      })),
  ]
    .sort((a, b) => {
      const weight = { CRITICO: 2, ATENCAO: 1, INFO: 0 } as const;
      return weight[b.prioridade] - weight[a.prioridade]
        || new Date(b.ocorridoEm).getTime() - new Date(a.ocorridoEm).getTime();
    })
    .slice(0, 12);

  const modules: Record<OperationalNodeModule, OperationalNode> = {
    VENDAS: sales ?? unavailableNode("VENDAS"),
    ORDENS: orders?.node ?? unavailableNode("ORDENS"),
    FINANCEIRO: finance ?? unavailableNode("FINANCEIRO"),
    CONTAS_RECEBER: allowed.has("CONTAS_RECEBER")
      ? accounts?.receivablesNode ?? unavailableNode("CONTAS_RECEBER")
      : unavailableNode("CONTAS_RECEBER"),
    CONTAS_PAGAR: allowed.has("CONTAS_PAGAR")
      ? accounts?.payablesNode ?? unavailableNode("CONTAS_PAGAR")
      : unavailableNode("CONTAS_PAGAR"),
    FISCAL: fiscal ?? unavailableNode("FISCAL"),
  };

  const snapshot: OperationalSnapshot = {
    meta: {
      tenantId: tenant.id,
      empresa: tenant.nomefantasia || tenant.razaosocial,
      atualizadoEm: nowIso,
      status: "SINCRONIZADO",
      periodo: period,
      periodoInicio: window.start,
      periodoFimExclusivo: window.end,
      modulosPermitidos: OPERATIONAL_MODULES.filter((module) => allowed.has(module)),
    },
    geral: {
      usuariosAtivos: null,
      operacoesPeriodo: eventCountResult.count ?? 0,
      osAtivas: orders?.active ?? null,
    },
    modulos: modules,
    eventosPeriodo: eventCountResult.count ?? 0,
    eventosRecentes: recentEvents,
    atencoes: attentions,
  };

  return operationalSnapshotSchema.parse(snapshot);
}
