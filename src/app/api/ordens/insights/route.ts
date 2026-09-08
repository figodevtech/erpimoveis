// src/app/api/ordens/insights/route.ts

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { chunkValues, fetchAllSupabaseRows, fetchAllSupabaseRowsByChunks } from "@/lib/supabase-pagination";
import {
  SERVICE_ORDER_COMPLETION_COLUMN,
  isServiceOrderCompleted,
  isServiceOrderOpen,
  serviceOrderCompletionDate,
  serviceOrderCompletionDurationHours,
} from "@/lib/dashboard/service-order-completion";

type Row = {
  id: number;
  status: string | null;
  statusaprovacao: string | null;
  prioridade: string | null;
  dataentrada: string | null;
  execucao_fim_em: string | null;
  orcamentototal: string | number | null;
  clienteid: number | null;
  setorid: number | null;
};

function toNum(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

const localDateKey = (value: Date | string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);

const todayISO = () => localDateKey(new Date());

function ymKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function dateKey(d: Date) {
  return localDateKey(d);
}

/** ==== Helpers de data (mesmo padrão do financeiro) ==== */
const FORTALEZA_OFFSET = "-03:00";

function localDayStartToUtcIso(dateStr: string) {
  return new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`).toISOString();
}

function localNextDayStartToUtcIso(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`);
  return new Date(d.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function makeServiceKey(ordemservicoid: number, servicoid: number) {
  return `${ordemservicoid}:${servicoid}`;
}

const ALL_OS_STATUSES = [
  "AGUARDANDO_CHECKLIST",
  "ORCAMENTO",
  "ORCAMENTO_RECUSADO",
  "APROVACAO_ORCAMENTO",
  "ORCAMENTO_APROVADO",
  "EM_ANDAMENTO",
  "PAGAMENTO",
  "FATURAMENTO",
  "SEM_COBRANCA",
  "CONCLUIDO",
  "CANCELADO",
] as const;

/**
 * Foto de agora: conta todas as OS por status, sem recorte de periodo. Usa
 * count/head para nao trazer linha nenhuma do banco.
 */
async function fetchCountsByStatusGeral(): Promise<Record<string, number>> {
  const counts = await Promise.all(
    ALL_OS_STATUSES.map(async (status) => {
      const { count, error } = await supabaseAdmin
        .from("ordemservico")
        .select("id", { count: "exact", head: true })
        .eq("is_deleted", false)
        .eq("status", status);
      if (error) throw error;
      return count ?? 0;
    }),
  );
  return Object.fromEntries(ALL_OS_STATUSES.map((status, i) => [status, counts[i] ?? 0]));
}

/** ========================= GET ========================= */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const months = Math.min(Math.max(Number(url.searchParams.get("months") ?? 12), 1), 36);

    const dateFrom = url.searchParams.get("dateFrom"); // YYYY-MM-DD
    const dateTo = url.searchParams.get("dateTo"); // YYYY-MM-DD

    const today = todayISO();
    const todayAnchor = new Date(`${today}T12:00:00Z`);
    const start = new Date(Date.UTC(todayAnchor.getUTCFullYear(), todayAnchor.getUTCMonth() - (months - 1), 1, 12));
    const monthKeys: string[] = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1, 12));
      monthKeys.push(ymKey(d));
    }

    // base da query filtrada pelos controles do dashboard
    const rows = (
      await fetchAllSupabaseRows<Row>(() => {
        let query = supabaseAdmin
          .from("ordemservico")
          .select("id, status, statusaprovacao, prioridade, dataentrada, execucao_fim_em, orcamentototal, clienteid, setorid")
          .eq("is_deleted", false)
          .order("id", { ascending: true });
        if (dateFrom) query = query.gte("dataentrada", localDayStartToUtcIso(dateFrom));
        if (dateTo) query = query.lt("dataentrada", localNextDayStartToUtcIso(dateTo));
        return query;
      })
    ).filter((row) => row.dataentrada);
    const totalOrders = rows.length;

    const completedPeriodRows = await fetchAllSupabaseRows<Row>(() => {
      let query = supabaseAdmin
        .from("ordemservico")
        .select("id, status, statusaprovacao, prioridade, dataentrada, execucao_fim_em, orcamentototal, clienteid, setorid")
        .eq("is_deleted", false)
        .not(SERVICE_ORDER_COMPLETION_COLUMN, "is", null)
        .order("id", { ascending: true });
      if (dateFrom) query = query.gte(SERVICE_ORDER_COMPLETION_COLUMN, localDayStartToUtcIso(dateFrom));
      if (dateTo) query = query.lt(SERVICE_ORDER_COMPLETION_COLUMN, localNextDayStartToUtcIso(dateTo));
      return query;
    });

    // Base independente do filtro da tela para os graficos mensais.
    const monthlyStartIso = localDayStartToUtcIso(`${monthKeys[0]}-01`);
    const monthlyRows = (
      await fetchAllSupabaseRows<Row>(() =>
        supabaseAdmin
          .from("ordemservico")
          .select("id, status, dataentrada, execucao_fim_em, orcamentototal")
          .eq("is_deleted", false)
          .or(`dataentrada.gte.${monthlyStartIso},${SERVICE_ORDER_COMPLETION_COLUMN}.gte.${monthlyStartIso}`)
          .order("id", { ascending: true }),
      )
    ).filter((row) => row.dataentrada || row.execucao_fim_em);

    const todayStart = localDayStartToUtcIso(today);
    const tomorrowStart = localNextDayStartToUtcIso(today);

    const [todayRows, todayCompletedRows, countsByStatusGeral] = await Promise.all([
      fetchAllSupabaseRows<Row>(() =>
        supabaseAdmin
          .from("ordemservico")
          .select("id, status, dataentrada, execucao_fim_em, orcamentototal")
          .eq("is_deleted", false)
          .gte("dataentrada", todayStart)
          .lt("dataentrada", tomorrowStart)
          .order("id", { ascending: true }),
      ),
      fetchAllSupabaseRows<Row>(() =>
        supabaseAdmin
          .from("ordemservico")
          .select("id, status, dataentrada, execucao_fim_em, orcamentototal")
          .eq("is_deleted", false)
          .gte(SERVICE_ORDER_COMPLETION_COLUMN, todayStart)
          .lt(SERVICE_ORDER_COMPLETION_COLUMN, tomorrowStart)
          .order("id", { ascending: true }),
      ),
      fetchCountsByStatusGeral(),
    ]);

    const inProgressGeral = countsByStatusGeral.EM_ANDAMENTO ?? 0;
    const ordersOpenGeral = Object.entries(countsByStatusGeral).reduce(
      (total, [status, quantidade]) => (isServiceOrderOpen(status) ? total + quantidade : total),
      0,
    );

    const monthlyNew: Record<string, number> = Object.fromEntries(monthKeys.map((k) => [k, 0]));
    const monthlyCompleted: Record<string, number> = Object.fromEntries(monthKeys.map((k) => [k, 0]));
    const monthlyRevenue: Record<string, number> = Object.fromEntries(monthKeys.map((k) => [k, 0]));

    const last7: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayAnchor);
      d.setUTCDate(d.getUTCDate() - i);
      last7.push(d.toISOString().slice(0, 10));
    }
    const daily7: Record<string, number> = Object.fromEntries(last7.map((d) => [d, 0]));

    const countsByStatus: Record<string, number> = {};
    const countsByApproval: Record<string, number> = {};
    const countsByPriority: Record<string, number> = {};

    let ordersOpen = 0;
    const ordersCompleted = completedPeriodRows.length;

    let totalBudget = 0;
    const revenueCompleted = completedPeriodRows.reduce((sum, row) => sum + toNum(row.orcamentototal), 0);
    const revenueToday = todayCompletedRows.reduce((sum, row) => sum + toNum(row.orcamentototal), 0);
    const ordersToday = todayRows.length;
    const ordersTodayCompleted = todayCompletedRows.length;

    const durationsHours: number[] = [];

    for (const r of rows) {
      const ve = r.dataentrada ? new Date(r.dataentrada) : null;
      const budget = toNum(r.orcamentototal);

      totalBudget += budget;

      const st = String(r.status ?? "NULL");
      countsByStatus[st] = (countsByStatus[st] ?? 0) + 1;

      const ap = String(r.statusaprovacao ?? "NULL");
      countsByApproval[ap] = (countsByApproval[ap] ?? 0) + 1;

      const pr = String(r.prioridade ?? "NULL");
      countsByPriority[pr] = (countsByPriority[pr] ?? 0) + 1;

      if (isServiceOrderOpen(st)) ordersOpen += 1;

      if (ve) {
        const dk = dateKey(ve);
        if (daily7[dk] !== undefined) daily7[dk] += 1;

      }
    }

    for (const row of completedPeriodRows) {
      const hours = serviceOrderCompletionDurationHours(row);
      if (hours !== null) durationsHours.push(hours);
    }

    for (const r of monthlyRows) {
      const ve = r.dataentrada ? new Date(r.dataentrada) : null;
      const completedAt = serviceOrderCompletionDate(r);
      const vs = completedAt ? new Date(completedAt) : null;
      const budget = toNum(r.orcamentototal);

      if (ve) {
        const key = localDateKey(ve).slice(0, 7);
        if (monthlyNew[key] !== undefined) monthlyNew[key] += 1;
      }

      if (isServiceOrderCompleted(r) && vs) {
        const key2 = localDateKey(vs).slice(0, 7);
        if (monthlyCompleted[key2] !== undefined) monthlyCompleted[key2] += 1;
        if (monthlyRevenue[key2] !== undefined) monthlyRevenue[key2] += budget;
      }
    }

    const avgCompletionHours = durationsHours.length
      ? durationsHours.reduce((a, b) => a + b, 0) / durationsHours.length
      : 0;

    const avgTicketAll = totalOrders ? totalBudget / totalOrders : 0;

    const monthlyNewArr = monthKeys.map((k) => ({ month: k, count: monthlyNew[k] ?? 0 }));
    const monthlyCompletedArr = monthKeys.map((k) => ({ month: k, count: monthlyCompleted[k] ?? 0 }));
    const monthlyRevenueArr = monthKeys.map((k) => ({ month: k, amount: monthlyRevenue[k] ?? 0 }));
    const last7DaysNewArr = last7.map((d) => ({ date: d, count: daily7[d] ?? 0 }));

    /** ==== Ranking de serviços por usuário (PK composta) ==== */
    const completedOsIds = completedPeriodRows
      .map((r) => r.id)
      .filter((id) => id != null) as number[];

    let servicesByUser: {
      usuarioId: string;
      usuarioNome: string;
      usuarioEmail: string;
      totalServicos: number;
    }[] = [];

    let servicesWithoutRealizador = 0;

    if (completedOsIds.length > 0) {
      // A) Todos os serviços existentes (ordemservicoid, servicoid) das OS concluídas
      type OsServicoRow = { ordemservicoid: number; servicoid: number };

      const allServices = await fetchAllSupabaseRowsByChunks<OsServicoRow, number>(
        completedOsIds,
        (chunk) =>
          supabaseAdmin
            .from("osservico")
            .select("ordemservicoid, servicoid")
            .in("ordemservicoid", chunk)
            .order("ordemservicoid", { ascending: true })
            .order("servicoid", { ascending: true }),
      );
      const allServicesKeys = new Set<string>();
      for (const service of allServices) {
        const osid = Number(service.ordemservicoid);
        const sid = Number(service.servicoid);
        if (!Number.isFinite(osid) || !Number.isFinite(sid)) continue;
        allServicesKeys.add(makeServiceKey(osid, sid));
      }

      // B) Realizadores por serviço via pivot (ordemservicoid, servicoid, usuarioid)
      type PivotRow = {
        ordemservicoid: number;
        servicoid: number;
        usuarioid: string;
        usuario:
          | { id: string; nome: string | null; email: string | null }
          | { id: string; nome: string | null; email: string | null }[]
          | null;
      };

      const userMap = new Map<string, { id: string; nome: string; email: string; services: Set<string> }>();
      const keysWithRealizador = new Set<string>();

      for (const chunk of chunkValues(completedOsIds, 300)) {
        const part = await fetchAllSupabaseRows<PivotRow>(() =>
          supabaseAdmin
            .from("osservico_realizador")
            .select(
              `
              ordemservicoid,
              servicoid,
              usuarioid,
              usuario:usuarioid ( id, nome, email )
              `,
            )
            .in("ordemservicoid", chunk)
            .order("ordemservicoid", { ascending: true })
            .order("servicoid", { ascending: true }),
        );

        for (const p of part) {
          const osid = Number((p as any).ordemservicoid);
          const sid = Number((p as any).servicoid);
          if (!Number.isFinite(osid) || !Number.isFinite(sid)) continue;

          const key = makeServiceKey(osid, sid);
          if (!allServicesKeys.has(key)) continue; // sanity-check

          const uid = String((p as any).usuarioid ?? "").trim();
          if (!uid) continue;

          const u = Array.isArray((p as any).usuario) ? (p as any).usuario[0] : (p as any).usuario;

          keysWithRealizador.add(key);

          const curr = userMap.get(uid) ?? {
            id: uid,
            nome: (u?.nome ?? "").trim(),
            email: (u?.email ?? "").trim(),
            services: new Set<string>(),
          };

          // garante que o serviço conta 1x por usuário, mesmo com linhas duplicadas
          curr.services.add(key);

          // se caiu aqui antes sem dados do usuário, tenta preencher agora
          if (!curr.nome && u?.nome) curr.nome = String(u.nome).trim();
          if (!curr.email && u?.email) curr.email = String(u.email).trim();

          userMap.set(uid, curr);
        }
      }

      servicesWithoutRealizador = Array.from(allServicesKeys).filter((k) => !keysWithRealizador.has(k)).length;

      servicesByUser = Array.from(userMap.values())
        .map((u) => ({
          usuarioId: u.id,
          usuarioNome: u.nome || u.email || "Usuário",
          usuarioEmail: u.email,
          totalServicos: u.services.size,
        }))
        .sort((a, b) => b.totalServicos - a.totalServicos)
        .slice(0, 10);
    }

    return NextResponse.json(
      {
        totalOrders,
        ordersOpen,
        ordersCompleted,
        totalBudget,
        avgTicketAll,
        avgCompletionHours,
        ordersToday,
        ordersTodayCompleted,
        revenueToday,
        revenueCompleted,
        countsByStatus,
        countsByStatusGeral,
        ordersOpenGeral,
        inProgressGeral,
        countsByApproval,
        countsByPriority,
        monthlyNew: monthlyNewArr,
        monthlyCompleted: monthlyCompletedArr,
        monthlyRevenue: monthlyRevenueArr,
        last7DaysNew: last7DaysNewArr,
        servicesByUser,
        servicesWithoutRealizador,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const payload = {
      error: e?.message || "Erro ao gerar insights de ordens de serviço",
      code: e?.code,
      hint: e?.hint,
      details: e?.details,
    };
    console.error("insights error:", payload, e);
    return NextResponse.json(payload, { status: 500 });
  }
}
