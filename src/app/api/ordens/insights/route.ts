// src/app/api/ordens/insights/route.ts

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/** Ajuste aqui se quiser considerar somente status específicos como "concluída".
 *  Por padrão, consideramos 'concluída' quando datasaida != null. */
const COMPLETED_BY_STATUS: string[] | null = ["CONCLUIDO"];

type Row = {
  id: number;
  status: string | null;
  statusaprovacao: string | null;
  prioridade: string | null;
  dataentrada: string | null;
  datasaida: string | null;
  orcamentototal: string | number | null;
  clienteid: number | null;
  setorid: number | null;
};

function toNum(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

const MS_PER_HOUR = 1000 * 60 * 60;
const todayISO = () => new Date().toISOString().slice(0, 10);

function ymKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
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

function chunkArray<T>(arr: T[], chunkSize: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) out.push(arr.slice(i, i + chunkSize));
  return out;
}

function makeServiceKey(ordemservicoid: number, servicoid: number) {
  return `${ordemservicoid}:${servicoid}`;
}

/** ========================= GET ========================= */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const months = Math.min(Math.max(Number(url.searchParams.get("months") ?? 12), 1), 36);

    const dateFrom = url.searchParams.get("dateFrom"); // YYYY-MM-DD
    const dateTo = url.searchParams.get("dateTo"); // YYYY-MM-DD

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const monthKeys: string[] = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      monthKeys.push(ymKey(d));
    }

    // base da query filtrada pelos controles do dashboard
    let query = supabaseAdmin
      .from("ordemservico")
      .select("id, status, statusaprovacao, prioridade, dataentrada, datasaida, orcamentototal, clienteid, setorid");

    // intervalo de datas (inclusive) em timezone Fortaleza
    if (dateFrom) query = query.gte("dataentrada", localDayStartToUtcIso(dateFrom));
    if (dateTo) query = query.lt("dataentrada", localNextDayStartToUtcIso(dateTo));

    const { data, error } = await query;
    if (error) throw error;

    const rows = ((data ?? []) as Row[]).filter((r) => r.dataentrada);
    const totalOrders = rows.length;

    // Base independente do filtro da tela para os graficos mensais.
    const monthlyStartIso = new Date(start.getFullYear(), start.getMonth(), 1).toISOString();
    const { data: monthlyData, error: monthlyError } = await supabaseAdmin
      .from("ordemservico")
      .select("id, status, dataentrada, datasaida, orcamentototal")
      .or(`dataentrada.gte.${monthlyStartIso},datasaida.gte.${monthlyStartIso}`);

    if (monthlyError) throw monthlyError;

    const monthlyRows = ((monthlyData ?? []) as Row[]).filter((r) => r.dataentrada || r.datasaida);

    const ms30 = 30 * 24 * 60 * 60 * 1000;
    const start30 = new Date(now.getTime() - ms30);

    const monthlyNew: Record<string, number> = Object.fromEntries(monthKeys.map((k) => [k, 0]));
    const monthlyCompleted: Record<string, number> = Object.fromEntries(monthKeys.map((k) => [k, 0]));
    const monthlyRevenue: Record<string, number> = Object.fromEntries(monthKeys.map((k) => [k, 0]));

    const last7: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      last7.push(dateKey(d));
    }
    const daily7: Record<string, number> = Object.fromEntries(last7.map((d) => [d, 0]));

    const countsByStatus: Record<string, number> = {};
    const countsByApproval: Record<string, number> = {};
    const countsByPriority: Record<string, number> = {};

    let ordersOpen = 0;
    let ordersCompleted = 0;

    let totalBudget = 0;
    let revenue30d = 0;
    let revenueToday = 0;
    let ordersToday = 0;
    let ordersTodayCompleted = 0;

    const durationsHours: number[] = [];
    const today = todayISO();

    const isCompleted = (r: Row) => {
      const hasExitDate = !!r.datasaida;
      if (COMPLETED_BY_STATUS && COMPLETED_BY_STATUS.length > 0) {
        return hasExitDate || (r.status && COMPLETED_BY_STATUS.includes(r.status));
      }
      return hasExitDate;
    };

    for (const r of rows) {
      const ve = r.dataentrada ? new Date(r.dataentrada) : null;
      const vs = r.datasaida ? new Date(r.datasaida) : null;
      const budget = toNum(r.orcamentototal);

      totalBudget += budget;

      const st = String(r.status ?? "NULL");
      countsByStatus[st] = (countsByStatus[st] ?? 0) + 1;

      const ap = String(r.statusaprovacao ?? "NULL");
      countsByApproval[ap] = (countsByApproval[ap] ?? 0) + 1;

      const pr = String(r.prioridade ?? "NULL");
      countsByPriority[pr] = (countsByPriority[pr] ?? 0) + 1;

      if (isCompleted(r)) ordersCompleted += 1;
      else ordersOpen += 1;

      if (ve) {
        const dk = dateKey(ve);
        if (daily7[dk] !== undefined) daily7[dk] += 1;

        if (dk === today) ordersToday += 1;
      }

      if (isCompleted(r) && vs) {
        const dk2 = dateKey(vs);
        if (dk2 === today) {
          ordersTodayCompleted += 1;
          revenueToday += budget;
        }
        if (vs >= start30) revenue30d += budget;

        if (ve) {
          const hrs = (vs.getTime() - ve.getTime()) / MS_PER_HOUR;
          if (Number.isFinite(hrs) && hrs >= 0) durationsHours.push(hrs);
        }
      }
    }

    for (const r of monthlyRows) {
      const ve = r.dataentrada ? new Date(r.dataentrada) : null;
      const vs = r.datasaida ? new Date(r.datasaida) : null;
      const budget = toNum(r.orcamentototal);

      if (ve) {
        const key = ymKey(new Date(ve.getFullYear(), ve.getMonth(), 1));
        if (monthlyNew[key] !== undefined) monthlyNew[key] += 1;
      }

      if (isCompleted(r) && vs) {
        const key2 = ymKey(new Date(vs.getFullYear(), vs.getMonth(), 1));
        if (monthlyCompleted[key2] !== undefined) monthlyCompleted[key2] += 1;
        if (monthlyRevenue[key2] !== undefined) monthlyRevenue[key2] += budget;
      }
    }

    durationsHours.sort((a, b) => a - b);
    const avgCompletionHours = durationsHours.length
      ? durationsHours.reduce((a, b) => a + b, 0) / durationsHours.length
      : 0;
    const p50CompletionHours = durationsHours.length
      ? durationsHours[Math.floor((durationsHours.length - 1) * 0.5)]
      : 0;
    const p90CompletionHours = durationsHours.length
      ? durationsHours[Math.floor((durationsHours.length - 1) * 0.9)]
      : 0;

    const avgTicketAll = totalOrders ? totalBudget / totalOrders : 0;

    const monthlyNewArr = monthKeys.map((k) => ({ month: k, count: monthlyNew[k] ?? 0 }));
    const monthlyCompletedArr = monthKeys.map((k) => ({ month: k, count: monthlyCompleted[k] ?? 0 }));
    const monthlyRevenueArr = monthKeys.map((k) => ({ month: k, amount: monthlyRevenue[k] ?? 0 }));
    const last7DaysNewArr = last7.map((d) => ({ date: d, count: daily7[d] ?? 0 }));

    /** ==== Ranking de serviços por usuário (PK composta) ==== */
    const completedOsIds = rows
      .filter((r) => isCompleted(r))
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

      const allServicesKeys = new Set<string>();

      for (const chunk of chunkArray(completedOsIds, 800)) {
        const { data: part, error: servErr } = await supabaseAdmin
          .from("osservico")
          .select("ordemservicoid, servicoid")
          .in("ordemservicoid", chunk);

        if (servErr) throw servErr;

        for (const s of (part ?? []) as unknown as OsServicoRow[]) {
          const osid = Number((s as any).ordemservicoid);
          const sid = Number((s as any).servicoid);
          if (!Number.isFinite(osid) || !Number.isFinite(sid)) continue;
          allServicesKeys.add(makeServiceKey(osid, sid));
        }
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

      for (const chunk of chunkArray(completedOsIds, 800)) {
        const { data: part, error: pivErr } = await supabaseAdmin
          .from("osservico_realizador")
          .select(
            `
              ordemservicoid,
              servicoid,
              usuarioid,
              usuario:usuarioid ( id, nome, email )
            `
          )
          .in("ordemservicoid", chunk);

        if (pivErr) throw pivErr;

        for (const p of (part ?? []) as unknown as PivotRow[]) {
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
        p50CompletionHours,
        p90CompletionHours,
        ordersToday,
        ordersTodayCompleted,
        revenueToday,
        revenue30d,
        countsByStatus,
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
