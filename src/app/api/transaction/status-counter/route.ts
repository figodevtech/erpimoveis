export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { valorLiquidoEfetivo } from "@/lib/financeiro/transacao";

const TIPO_RECEITA = "RECEITA";
const TIPO_DESPESA = "DESPESA";
const TIMEZONE = "America/Fortaleza";

/** Converte uma data "parede" no TZ para UTC real */
function wallTimeInTZToUTC(y: number, m1: number, d: number, H = 0, M = 0, S = 0, ms = 0, tz = TIMEZONE): Date {
  const guessUtc = new Date(Date.UTC(y, m1, d, H, M, S, ms));
  const tzAsLocal = new Date(guessUtc.toLocaleString("en-US", { timeZone: tz }));
  const offsetMs = tzAsLocal.getTime() - guessUtc.getTime();
  return new Date(Date.UTC(y, m1, d, H, M, S, ms) - offsetMs);
}

/** Calcula início do mês e início do próximo mês para (year, month) no TZ */
function monthBoundsISO({ year, month, tz = TIMEZONE }: { year: number; month: number; tz?: string }) {
  // month: 1..12
  const start = wallTimeInTZToUTC(year, month - 1, 1, 0, 0, 0, 0, tz);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextStart = wallTimeInTZToUTC(nextYear, nextMonth - 1, 1, 0, 0, 0, 0, tz);
  return { startISO: start.toISOString(), nextStartISO: nextStart.toISOString() };
}

/** Resolve (year, month) a partir de agora no TZ + offset, ou params explícitos */
function resolveYearMonth({ tz, yearParam, monthParam, offsetParam }: { tz: string; yearParam?: string | null; monthParam?: string | null; offsetParam?: string | null }) {
  const yearNum = yearParam ? Number(yearParam) : null;
  const monthNum = monthParam ? Number(monthParam) : null;

  if (yearNum && monthNum && monthNum >= 1 && monthNum <= 12) {
    return { year: yearNum, month: monthNum };
  }

  // pega "agora" no TZ
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" })
    .format(now)
    .split("-");
  let y = Number(parts[0]);
  let m = Number(parts[1]); // 1..12

  const offset = Number(offsetParam ?? 0);
  if (Number.isFinite(offset) && offset !== 0) {
    // ajusta mês com overflow/underflow
    const base = new Date(Date.UTC(y, m - 1, 1));
    base.setUTCMonth(base.getUTCMonth() + offset);
    const yy = base.getUTCFullYear();
    const mm = base.getUTCMonth() + 1; // 1..12
    y = yy;
    m = mm;
  }

  return { year: y, month: m };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    // Na aba Fluxo, os cards precisam obedecer ao mesmo recorte da tabela:
    // somente liquidações que efetivamente passaram por uma conta bancária.
    // Em Liquidadas o parâmetro não vem, preservando a visão geral (inclusive
    // títulos quitados por adiantamento, que ficam sem banco de propósito).
    const comBanco = searchParams.get("comBanco") === "true";
    const { year, month } = resolveYearMonth({
      tz: TIMEZONE,
      yearParam: searchParams.get("year"),
      monthParam: searchParams.get("month"),
      offsetParam: searchParams.get("offset"), // ex.: -1 = mês anterior
    });

    const { startISO, nextStartISO } = monthBoundsISO({ year, month, tz: TIMEZONE });

    // RECEITAS
    let receitasQuery = supabaseAdmin
      .from("transacao")
      .select('valor, "valorLiquido", valor_descontos, tipo')
      .eq("tipo", TIPO_RECEITA).eq("pendente", false).eq("is_deleted", false)
      .gte("data", startISO)
      .lt("data", nextStartISO);
    /*
     * Sem o recorte do extrato, a baixa parcial sairia somada duas vezes: uma no
     * título que ela fechou e outra nela mesma. Fica o título, que é a obrigação
     * quitada; as baixas contam no Fluxo, onde o filtro de banco já as separa.
     */
    if (comBanco) receitasQuery = receitasQuery.not("banco_id", "is", null);
    else receitasQuery = receitasQuery.is("baixa_de_transacao_id", null);

    const { data: receitas, error: recErr } = await receitasQuery;
    if (recErr) throw recErr;

    // DESPESAS
    let despesasQuery = supabaseAdmin
      .from("transacao")
      .select('valor, "valorLiquido", valor_descontos, tipo')
      .eq("tipo", TIPO_DESPESA).eq("pendente", false).eq("is_deleted", false)
      .gte("data", startISO)
      .lt("data", nextStartISO);
    if (comBanco) despesasQuery = despesasQuery.not("banco_id", "is", null);
    else despesasQuery = despesasQuery.is("baixa_de_transacao_id", null);

    const { data: despesas, error: despErr } = await despesasQuery;
    if (despErr) throw despErr;

    // Mesma regra exibida na coluna da tabela: líquido quando ele é aplicável e
    // válido; bruto como fallback para registros antigos ou despesas sem taxa.
    const somar = (transacoes: typeof receitas) =>
      (transacoes ?? []).reduce(
        (centavos, transacao) =>
          centavos + Math.round(valorLiquidoEfetivo(transacao) * 100),
        0,
      ) / 100;

    const somaReceitas = somar(receitas);
    const somaDespesas = somar(despesas);

    return NextResponse.json({ somaReceitas, somaDespesas, year, month });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Erro ao calcular status-counter" },
      { status: 500 }
    );
  }
}
