export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
    const { year, month } = resolveYearMonth({
      tz: TIMEZONE,
      yearParam: searchParams.get("year"),
      monthParam: searchParams.get("month"),
      offsetParam: searchParams.get("offset"), // ex.: -1 = mês anterior
    });

    const { startISO, nextStartISO } = monthBoundsISO({ year, month, tz: TIMEZONE });

    // RECEITAS
    const { data: receitas, error: recErr } = await supabaseAdmin
      .from("transacao")
      .select("valorLiquido")
      .eq("tipo", TIPO_RECEITA).eq("pendente", false).eq("is_deleted", false)
      .gte("data", startISO)
      .lt("data", nextStartISO);
    if (recErr) throw recErr;

    // DESPESAS
    const { data: despesas, error: despErr } = await supabaseAdmin
      .from("transacao")
      .select("valorLiquido")
      .eq("tipo", TIPO_DESPESA).eq("pendente", false).eq("is_deleted", false)
      .gte("data", startISO)
      .lt("data", nextStartISO);
    if (despErr) throw despErr;

    const somaReceitas = (receitas ?? []).reduce((acc, r: any) => acc + (Number(r.valorLiquido) || 0), 0);
    const somaDespesas = (despesas ?? []).reduce((acc, d: any) => acc + (Number(d.valorLiquido) || 0), 0);

    return NextResponse.json({ somaReceitas, somaDespesas, year, month });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Erro ao calcular status-counter" },
      { status: 500 }
    );
  }
}
