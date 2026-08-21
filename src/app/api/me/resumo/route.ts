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
  STATUS_OS_EM_EXECUCAO,
  STATUS_OS_FINALIZADAS,
  STATUS_VENDAS_REALIZADAS,
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
      .eq("vendedor", userId)
      .in("status", STATUS_VENDAS_REALIZADAS)
      .not("pagamento_em", "is", null);
    if (periodo.inicio) vendasQuery = vendasQuery.gte("pagamento_em", periodo.inicio);
    if (periodo.fimExclusivo) vendasQuery = vendasQuery.lt("pagamento_em", periodo.fimExclusivo);

    // Mesma definicao da aba: OS abertas pelo usuario cujo trabalho terminou,
    // contadas no periodo em que a execucao foi encerrada.
    let ordensQuery = supabaseAdmin
      .from("ordemservico")
      .select("orcamentototal", { count: "exact" })
      .eq("usuariocriadorid", userId)
      .eq("is_deleted", false)
      .in("status", STATUS_OS_FINALIZADAS)
      .not("execucao_fim_em", "is", null);
    if (periodo.inicio) ordensQuery = ordensQuery.gte("execucao_fim_em", periodo.inicio);
    if (periodo.fimExclusivo) ordensQuery = ordensQuery.lt("execucao_fim_em", periodo.fimExclusivo);

    // `osservico_realizador` nao tem FK direta para `ordemservico` (a dela e
    // composta, para `osservico`); a OS vem em dois saltos. O mesmo embed ja
    // traz o subtotal do item, dispensando uma segunda consulta.
    let servicosRealizadosQuery = supabaseAdmin
      .from("osservico_realizador")
      .select(
        "item:osservico!inner ( subtotal, ordem:ordemservicoid!inner ( id, status, is_deleted, execucao_fim_em ) )",
        { count: "exact" },
      )
      .eq("usuarioid", userId)
      .eq("item.ordem.is_deleted", false)
      .in("item.ordem.status", STATUS_OS_FINALIZADAS)
      .not("item.ordem.execucao_fim_em", "is", null);
    if (periodo.inicio) {
      servicosRealizadosQuery = servicosRealizadosQuery.gte("item.ordem.execucao_fim_em", periodo.inicio);
    }
    if (periodo.fimExclusivo) {
      servicosRealizadosQuery = servicosRealizadosQuery.lt(
        "item.ordem.execucao_fim_em",
        periodo.fimExclusivo,
      );
    }

    // Snapshot atual: servicos atribuidos ao usuario em OS que ainda estao em
    // execucao. Ele nao usa o periodo historico porque ainda nao existe data de
    // conclusao para posicionar essas OS na janela selecionada.
    const servicosEmExecucaoQuery = supabaseAdmin
      .from("osservico_realizador")
      .select("item:osservico!inner ( ordem:ordemservicoid!inner ( id ) )", {
        count: "exact",
        head: true,
      })
      .eq("usuarioid", userId)
      .eq("item.ordem.is_deleted", false)
      .in("item.ordem.status", STATUS_OS_EM_EXECUCAO)
      .is("item.ordem.execucao_fim_em", null);

    const [vendasRes, ordensRes, servicosRealizadosRes, servicosEmExecucaoRes] = await Promise.all([
      vendasQuery.range(0, TETO_VENDAS_ORDENS - 1),
      ordensQuery.range(0, TETO_VENDAS_ORDENS - 1),
      servicosRealizadosQuery.range(0, TETO_SERVICOS - 1),
      servicosEmExecucaoQuery,
    ]);

    if (vendasRes.error) throw vendasRes.error;
    if (ordensRes.error) throw ordensRes.error;
    if (servicosRealizadosRes.error) throw servicosRealizadosRes.error;
    if (servicosEmExecucaoRes.error) throw servicosEmExecucaoRes.error;

    const linhasVendas = vendasRes.data ?? [];
    const linhasOrdens = ordensRes.data ?? [];
    const linhasServicosRealizados = (servicosRealizadosRes.data ?? []).map(
      (row) => row as unknown as Record<string, unknown>,
    );

    // Valor dos servicos realizados: soma o subtotal do item na OS. O valor e o
    // do servico inteiro; quando ha mais de um realizador ele nao e rateado.
    const valorServicosRealizados = linhasServicosRealizados.reduce((acc, linha) => {
      const item = Array.isArray(linha.item) ? linha.item[0] : linha.item;
      const registro = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
      return acc + num(registro?.subtotal);
    }, 0);

    const totalVendas = vendasRes.count ?? linhasVendas.length;
    const totalOrdens = ordensRes.count ?? linhasOrdens.length;
    const totalServicosRealizados =
      servicosRealizadosRes.count ?? linhasServicosRealizados.length;

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
        servicosRealizados: {
          quantidade: totalServicosRealizados,
          valor: valorServicosRealizados,
          parcial: totalServicosRealizados > linhasServicosRealizados.length,
        },
        servicosEmAndamento: {
          quantidade: servicosEmExecucaoRes.count ?? 0,
          parcial: false,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return erroInterno("GET /api/me/resumo", e);
  }
}
