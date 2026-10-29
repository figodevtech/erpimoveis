// src/app/api/me/resumo/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  erroInterno,
  getMeUserId,
  isNextResponse,
  num,
  parsePeriodo,
  STATUS_VENDAS_REALIZADAS,
} from "../_helpers";

/**
 * O total (contagem) vem do `count` exato do PostgREST. Ja a soma precisa das
 * linhas, entao e lida com um teto: se o periodo escolhido passar disso,
 * `parcial` volta true e a UI sinaliza que o valor esta truncado, em vez de
 * mostrar um numero errado com cara de certo.
 */
const TETO_VENDAS = 5000;

export async function GET(req: Request) {
  const userId = await getMeUserId(req);
  if (isNextResponse(userId)) return userId;

  try {
    const { searchParams } = new URL(req.url);
    const periodo = parsePeriodo(searchParams);

    // Mesmo eixo da aba de vendas (`pagamento_em`): se o card somasse por
    // `datavenda`, o total do periodo nunca bateria com a lista logo abaixo.
    let vendasQuery = supabaseAdmin
      .from("venda")
      .select("valortotal", { count: "exact" })
      .eq("vendedor", userId)
      .in("status", STATUS_VENDAS_REALIZADAS)
      .not("pagamento_em", "is", null);
    if (periodo.inicio) vendasQuery = vendasQuery.gte("pagamento_em", periodo.inicio);
    if (periodo.fimExclusivo) vendasQuery = vendasQuery.lt("pagamento_em", periodo.fimExclusivo);

    const vendasRes = await vendasQuery.range(0, TETO_VENDAS - 1);
    if (vendasRes.error) throw vendasRes.error;

    const linhasVendas = vendasRes.data ?? [];
    const totalVendas = vendasRes.count ?? linhasVendas.length;

    return NextResponse.json(
      {
        periodo: { de: searchParams.get("de"), ate: searchParams.get("ate") },
        vendas: {
          quantidade: totalVendas,
          valor: linhasVendas.reduce((acc, row) => acc + num((row as Record<string, unknown>).valortotal), 0),
          parcial: totalVendas > linhasVendas.length,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return erroInterno("GET /api/me/resumo", e);
  }
}
