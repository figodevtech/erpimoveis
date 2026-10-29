export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchAllSupabaseRows } from "@/lib/supabase-pagination";

type Row = {
  status: "ATIVO" | "INATIVO" | "PENDENTE" | null;
  tipopessoa: "FISICA" | "JURIDICA" | null;
  estado: string | null;
  cidade: string | null;
  createdat: string | null;
};

const FORTALEZA_OFFSET = "-03:00";
const MS_DIA = 24 * 60 * 60 * 1000;

function localDayStartToUtcIso(dateStr: string) {
  return new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`).toISOString();
}

function localNextDayStartToUtcIso(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`);
  return new Date(d.getTime() + MS_DIA).toISOString();
}

function ym(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

// createdat vem em UTC; converte para data local fixa -03:00 e retorna YYYY-MM-DD
function localDateKeyFromIso(iso: string) {
  const utc = new Date(iso);
  const localMs = utc.getTime() - 3 * 60 * 60 * 1000;
  return new Date(localMs).toISOString().slice(0, 10);
}

function localMonthKeyFromIso(iso: string) {
  return localDateKeyFromIso(iso).slice(0, 7);
}

function mesesEntre(inicioLocal: Date, fimLocal: Date) {
  const start = new Date(inicioLocal.getFullYear(), inicioLocal.getMonth(), 1);
  const end = new Date(fimLocal.getFullYear(), fimLocal.getMonth(), 1);

  const out: string[] = [];
  for (let d = new Date(start); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    out.push(ym(d));
  }
  return out;
}

function diasEntre(inicioLocal: Date, fimLocal: Date) {
  const start = new Date(inicioLocal.getFullYear(), inicioLocal.getMonth(), inicioLocal.getDate(), 0, 0, 0);
  const end = new Date(fimLocal.getFullYear(), fimLocal.getMonth(), fimLocal.getDate(), 0, 0, 0);

  const out: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += MS_DIA) {
    out.push(ymd(new Date(t)));
  }
  return out;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const monthsFallback = Math.min(Math.max(Number(url.searchParams.get("months") ?? 12), 1), 36);
    const dateFrom = url.searchParams.get("dateFrom"); // YYYY-MM-DD
    const dateTo = url.searchParams.get("dateTo"); // YYYY-MM-DD

    const rows = await fetchAllSupabaseRows<Row>(() => {
      let query = supabaseAdmin
        .from("cliente")
        .select("status, tipopessoa, estado, cidade, createdat")
        .eq("is_deleted", false)
        .order("id", { ascending: true });

      if (dateFrom) query = query.gte("createdat", localDayStartToUtcIso(dateFrom));
      if (dateTo) query = query.lt("createdat", localNextDayStartToUtcIso(dateTo));
      return query;
    });
    const totalClients = rows.length;

    const countsByStatus: Record<string, number> = { ATIVO: 0, INATIVO: 0, PENDENTE: 0 };
    const countsByTipo = { FISICA: 0, JURIDICA: 0 } as Record<"FISICA" | "JURIDICA", number>;
    const byEstado: Record<string, number> = {};
    const byCidade: Record<string, number> = {};

    // âncora para comparativos 30d
    const fimRef = dateTo ? new Date(`${dateTo}T23:59:59${FORTALEZA_OFFSET}`) : new Date();

    const ms30 = 30 * MS_DIA;
    const startCurr = new Date(fimRef.getTime() - ms30);
    const startPrev = new Date(fimRef.getTime() - 2 * ms30);

    const start90 = new Date(fimRef.getTime() - 90 * MS_DIA);
    const [
      { count: recent30d, error: recentError },
      { count: prev30d, error: prevError },
      vendasRecentes,
    ] = await Promise.all([
      supabaseAdmin
        .from("cliente")
        .select("*", { count: "exact", head: true })
        .eq("is_deleted", false)
        .gte("createdat", startCurr.toISOString())
        .lte("createdat", fimRef.toISOString()),
      supabaseAdmin
        .from("cliente")
        .select("*", { count: "exact", head: true })
        .eq("is_deleted", false)
        .gte("createdat", startPrev.toISOString())
        .lt("createdat", startCurr.toISOString()),

      fetchAllSupabaseRows<any>(() =>
        supabaseAdmin
          .from("venda")
          .select("clienteid,datavenda")
          .not("clienteid", "is", null)
          .in("status", ["PAGAMENTO", "FINALIZADA", "PAGO", "AUTORIZADO"])
          .gte("datavenda", start90.toISOString())
          .lte("datavenda", fimRef.toISOString())
          .order("datavenda", { ascending: true }),
      ),
    ]);
    if (recentError) throw recentError;
    if (prevError) throw prevError;

    const interacoes90 = new Map<number, number>();
    const clientesAtendidos30 = new Set<number>();
    for (const item of vendasRecentes) {
      const clienteId = Number(item.clienteid);
      if (!Number.isFinite(clienteId)) continue;
      interacoes90.set(clienteId, (interacoes90.get(clienteId) ?? 0) + 1);
      const dataInteracao = String(item.dataentrada ?? item.datavenda ?? "");
      if (dataInteracao >= startCurr.toISOString()) clientesAtendidos30.add(clienteId);
    }
    const clientesRecorrentes90 = Array.from(interacoes90.values()).filter((quantidade) => quantidade >= 2).length;
    const taxaRecorrencia90 = interacoes90.size > 0 ? (clientesRecorrentes90 / interacoes90.size) * 100 : 0;

    // ---- buckets mensais ----
    let monthsKeys: string[] = [];
    if (dateFrom && dateTo) {
      const iniLocal = new Date(`${dateFrom}T00:00:00${FORTALEZA_OFFSET}`);
      const fimLocal = new Date(`${dateTo}T23:59:59${FORTALEZA_OFFSET}`);
      monthsKeys = mesesEntre(iniLocal, fimLocal);
    } else {
      const start = new Date(fimRef.getFullYear(), fimRef.getMonth() - (monthsFallback - 1), 1);
      for (let i = 0; i < monthsFallback; i++) {
        const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
        monthsKeys.push(ym(d));
      }
    }

    const monthlyMap: Record<string, number> = Object.fromEntries(monthsKeys.map((k) => [k, 0]));

    // ---- buckets diários (somente quando houver filtro) ----
    let dailyNew: { date: string; count: number }[] | undefined;
    let dailyMap: Record<string, number> | undefined;
    let daysKeys: string[] | undefined;

    if (dateFrom && dateTo) {
      const iniLocal = new Date(`${dateFrom}T00:00:00${FORTALEZA_OFFSET}`);
      const fimLocal = new Date(`${dateTo}T23:59:59${FORTALEZA_OFFSET}`);
      daysKeys = diasEntre(iniLocal, fimLocal);
      dailyMap = Object.fromEntries(daysKeys.map((k) => [k, 0]));
    }

    for (const r of rows) {
      if (r.status && countsByStatus[r.status] !== undefined) countsByStatus[r.status]++;
      if (r.tipopessoa && countsByTipo[r.tipopessoa] !== undefined) countsByTipo[r.tipopessoa]++;

      const uf = (r.estado ?? "").toUpperCase();
      if (uf) byEstado[uf] = (byEstado[uf] ?? 0) + 1;

      const cid = (r.cidade ?? "").trim();
      if (cid) byCidade[cid] = (byCidade[cid] ?? 0) + 1;

      if (r.createdat) {
        const keyMes = localMonthKeyFromIso(r.createdat);
        if (monthlyMap[keyMes] !== undefined) monthlyMap[keyMes]++;

        if (dailyMap) {
          const keyDia = localDateKeyFromIso(r.createdat);
          if (dailyMap[keyDia] !== undefined) dailyMap[keyDia]++;
        }
      }
    }

    const monthlyNew = monthsKeys.map((k) => ({ month: k, count: monthlyMap[k] ?? 0 }));

    if (dailyMap && daysKeys) {
      dailyNew = daysKeys.map((k) => ({ date: k, count: dailyMap![k] ?? 0 }));
    }

    const topCidades = Object.entries(byCidade)
      .map(([cidade, count]) => ({ cidade, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return NextResponse.json(
      {
        totalClients,
        countsByStatus,
        countsByTipo,
        byEstado,
        topCidades,
        monthlyNew,
        dailyNew,
        recent30d: recent30d ?? 0,
        prev30d: prev30d ?? 0,
        clientesAtendidos30: clientesAtendidos30.size,
        clientesRecorrentes90,
        taxaRecorrencia90,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erro ao gerar insights de clientes" }, { status: 500 });
  }
}
