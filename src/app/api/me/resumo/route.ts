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
  STATUS_FINALIZADAS,
} from "../_helpers";

/**
 * Os totais (contagens) vem do `count` exato do PostgREST. Ja as somas precisam
 * das linhas, entao sao lidas com um teto: se o periodo escolhido passar disso,
 * `parcial` volta true e a UI sinaliza que o valor esta truncado, em vez de
 * mostrar um numero errado com cara de certo.
 */
const TETO_VENDAS_ORDENS = 5000;
const TETO_SERVICOS = 2000;

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
      .eq("vendedor", userId);
    if (periodo.inicio) vendasQuery = vendasQuery.gte("pagamento_em", periodo.inicio);
    if (periodo.fim) vendasQuery = vendasQuery.lte("pagamento_em", periodo.fim);

    // Mesma definicao da aba: OS abertas pelo usuario cujo trabalho terminou,
    // contadas no periodo em que a execucao foi encerrada.
    let ordensQuery = supabaseAdmin
      .from("ordemservico")
      .select("orcamentototal", { count: "exact" })
      .eq("usuariocriadorid", userId)
      .in("status", STATUS_FINALIZADAS);
    if (periodo.inicio) ordensQuery = ordensQuery.gte("execucao_fim_em", periodo.inicio);
    if (periodo.fim) ordensQuery = ordensQuery.lte("execucao_fim_em", periodo.fim);

    // `osservico_realizador` nao tem FK direta para `ordemservico` (a dela e
    // composta, para `osservico`); a OS vem em dois saltos. O mesmo embed ja
    // traz o subtotal do item, dispensando uma segunda consulta.
    let servicosQuery = supabaseAdmin
      .from("osservico_realizador")
      .select(
        "status_execucao, item:osservico!inner ( subtotal, ordem:ordemservicoid!inner ( id, execucao_fim_em ) )",
        { count: "exact" },
      )
      .eq("usuarioid", userId);
    if (periodo.inicio) servicosQuery = servicosQuery.gte("item.ordem.execucao_fim_em", periodo.inicio);
    if (periodo.fim) servicosQuery = servicosQuery.lte("item.ordem.execucao_fim_em", periodo.fim);

    const [vendasRes, ordensRes, servicosRes] = await Promise.all([
      vendasQuery.range(0, TETO_VENDAS_ORDENS - 1),
      ordensQuery.range(0, TETO_VENDAS_ORDENS - 1),
      servicosQuery.range(0, TETO_SERVICOS - 1),
    ]);

    if (vendasRes.error) throw vendasRes.error;
    if (ordensRes.error) throw ordensRes.error;
    if (servicosRes.error) throw servicosRes.error;

    const linhasVendas = vendasRes.data ?? [];
    const linhasOrdens = ordensRes.data ?? [];
    const linhasServicos = (servicosRes.data ?? []).map((row) => row as unknown as Record<string, unknown>);

    // Enum real da execucao: PENDENTE | EM_EXECUCAO | FINALIZADO.
    const finalizados = linhasServicos.filter(
      (linha) => String(linha.status_execucao ?? "").toUpperCase() === "FINALIZADO",
    );
    const emExecucao = linhasServicos.filter(
      (linha) => String(linha.status_execucao ?? "").toUpperCase() === "EM_EXECUCAO",
    );

    // Valor dos servicos finalizados: soma o subtotal do item na OS. O valor e o
    // do servico inteiro; quando ha mais de um realizador ele nao e rateado.
    const valorServicosFinalizados = finalizados.reduce((acc, linha) => {
      const item = Array.isArray(linha.item) ? linha.item[0] : linha.item;
      const registro = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
      return acc + num(registro?.subtotal);
    }, 0);

    const totalVendas = vendasRes.count ?? linhasVendas.length;
    const totalOrdens = ordensRes.count ?? linhasOrdens.length;
    const totalServicos = servicosRes.count ?? linhasServicos.length;

    return NextResponse.json(
      {
        periodo: { de: searchParams.get("de"), ate: searchParams.get("ate") },
        vendas: {
          quantidade: totalVendas,
          valor: linhasVendas.reduce((acc, row) => acc + num((row as Record<string, unknown>).valortotal), 0),
          parcial: totalVendas > linhasVendas.length,
        },
        ordens: {
          quantidade: totalOrdens,
          valor: linhasOrdens.reduce(
            (acc, row) => acc + num((row as Record<string, unknown>).orcamentototal),
            0,
          ),
          parcial: totalOrdens > linhasOrdens.length,
        },
        servicosFinalizados: {
          quantidade: finalizados.length,
          valor: valorServicosFinalizados,
          parcial: totalServicos > linhasServicos.length,
        },
        servicosEmAndamento: {
          quantidade: emExecucao.length,
          parcial: totalServicos > linhasServicos.length,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return erroInterno("GET /api/me/resumo", e);
  }
}
