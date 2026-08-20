// /src/app/api/users/[id]/comissao/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUsuariosAccess } from "@/app/api/_authz/perms";

function yyyymm(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function toDateOrNull(v?: string | null) {
  const s = (v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function num(v: any) {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

type Key = string;
const keyOf = (ordemservicoid: number, servicoid: number): Key => `${ordemservicoid}::${servicoid}`;

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUsuariosAccess();

    const { id: userId } = await context.params;

    const { searchParams } = new URL(req.url);
    const dateFrom = toDateOrNull(searchParams.get("dateFrom"));
    const dateTo = toDateOrNull(searchParams.get("dateTo"));

    // Usuário (só para cabeçalho/info)
    const { data: userRow, error: uErr } = await supabaseAdmin
      .from("usuario")
      .select("id, nome, email, comissao_percent")
      .eq("id", userId)
      .maybeSingle();

    if (uErr) throw uErr;
    if (!userRow) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

    // Linhas já calculadas (snapshot)
    const { data: relRows, error: relErr } = await supabaseAdmin
      .from("osservico_realizador")
      .select("ordemservicoid, servicoid, valor_base, valor_comissao, comissao_percent_aplicada")
      .eq("usuarioid", userId);

    if (relErr) throw relErr;

    const rel = (relRows ?? []).map((r: any) => ({
      ordemservicoid: Number(r.ordemservicoid),
      servicoid: Number(r.servicoid),
      valor_base: num(r.valor_base),
      valor_comissao: num(r.valor_comissao),
      comissao_percent_aplicada: num(r.comissao_percent_aplicada),
    }));

    if (rel.length === 0) {
      return NextResponse.json({
        usuario: { id: userRow.id, nome: userRow.nome, email: userRow.email },
        comissao_percent: num(userRow.comissao_percent), // atual (informativo)
        totalServicos: 0,
        totalFaturamento: 0,
        totalComissao: 0,
        meses: [],
      });
    }

    const osIds = Array.from(new Set(rel.map((x) => x.ordemservicoid))).filter(Boolean);

    // Data da OS (para filtrar/agrupamento)
    const OS_DATE_FIELD = "createdat";
    const { data: osDateRows, error: osDateErr } = await supabaseAdmin
      .from("ordemservico")
      .select(`id, ${OS_DATE_FIELD}`)
      .in("id", osIds);

    if (osDateErr) throw osDateErr;

    const osDateMap = new Map<number, string | null>();
    for (const r of osDateRows ?? []) {
      osDateMap.set(Number((r as any).id), (r as any)[OS_DATE_FIELD] ?? null);
    }

    // Quantidade do item (para "Serviços" inteiro como participação)
    const { data: osServicoRows, error: osServicoErr } = await supabaseAdmin
      .from("osservico")
      .select("ordemservicoid, servicoid, quantidade")
      .in("ordemservicoid", osIds);

    if (osServicoErr) throw osServicoErr;

    const qtdMap = new Map<Key, number>();
    for (const r of osServicoRows ?? []) {
      const k = keyOf(Number((r as any).ordemservicoid), Number((r as any).servicoid));
      qtdMap.set(k, num((r as any).quantidade) || 1);
    }

    const byMonth = new Map<string, { month: string; servicos: number; faturamento: number; comissao: number }>();

    let totalServicos = 0;
    let totalFaturamento = 0;
    let totalComissao = 0;

    for (const r of rel) {
      const osDateRaw = osDateMap.get(r.ordemservicoid) ?? null;
      if (!osDateRaw) continue;

      const d = new Date(osDateRaw);
      if (Number.isNaN(d.getTime())) continue;

      if (dateFrom && d < dateFrom) continue;
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        if (d > end) continue;
      }

      const month = yyyymm(d);
      const k = keyOf(r.ordemservicoid, r.servicoid);
      const qtd = qtdMap.get(k) ?? 1;

      const cur = byMonth.get(month) ?? { month, servicos: 0, faturamento: 0, comissao: 0 };
      cur.servicos += qtd;
      cur.faturamento += r.valor_base;
      cur.comissao += r.valor_comissao;
      byMonth.set(month, cur);

      totalServicos += qtd;
      totalFaturamento += r.valor_base;
      totalComissao += r.valor_comissao;
    }

    const meses = [...byMonth.values()]
      .map((m) => ({
        ...m,
        servicos: Math.round(m.servicos),
        faturamento: Number(m.faturamento || 0),
        comissao: Number(m.comissao || 0),
      }))
      .sort((a, b) => (a.month < b.month ? 1 : -1));

    return NextResponse.json({
      usuario: { id: userRow.id, nome: userRow.nome, email: userRow.email },
      comissao_percent: num(userRow.comissao_percent), // atual (informativo)
      totalServicos,
      totalFaturamento,
      totalComissao,
      meses,
      fonte: "osservico_realizador",
    });
  } catch (e: any) {
    console.error("[/api/users/:id/comissao GET] error:", e);
    const status = /não autenticado|unauth|auth/i.test(String(e?.message)) ? 401 : 500;
    return NextResponse.json({ error: e?.message ?? "Erro ao calcular comissão do usuário" }, { status });
  }
}
