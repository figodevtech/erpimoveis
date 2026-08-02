// src/app/api/me/ordens/indicadores/route.ts
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
} from "../../_helpers";

/**
 * Totais da aba "Ordens finalizadas".
 *
 * Vive fora de /api/me/ordens de proposito: os numeros cobrem o periodo inteiro,
 * nao a pagina, entao nao faz sentido recalcula-los a cada troca de pagina.
 *
 * O teto existe porque a soma precisa das linhas. Um usuario num periodo normal
 * nao chega perto disso; se chegar, `parcial` avisa a UI em vez de exibir um
 * numero truncado como se fosse o total.
 */
const TETO_ORDENS = 1000;

export async function GET(req: Request) {
  const userId = await getMeUserId();
  if (isNextResponse(userId)) return userId;

  try {
    const { searchParams } = new URL(req.url);
    const periodo = parsePeriodo(searchParams);

    // Mesmo recorte da lista: OS abertas pelo usuario cujo trabalho terminou.
    let ordensQuery = supabaseAdmin
      .from("ordemservico")
      .select("id, orcamentototal", { count: "exact" })
      .eq("usuariocriadorid", userId)
      .in("status", STATUS_FINALIZADAS);

    if (periodo.inicio) ordensQuery = ordensQuery.gte("execucao_fim_em", periodo.inicio);
    if (periodo.fim) ordensQuery = ordensQuery.lte("execucao_fim_em", periodo.fim);

    const { data: ordens, error, count } = await ordensQuery.range(0, TETO_ORDENS - 1);
    if (error) throw error;

    const linhas = ordens ?? [];
    const ids = linhas.map((linha) => Number((linha as Record<string, unknown>).id)).filter(Number.isFinite);
    const totalOrdens = count ?? linhas.length;

    const vazio = {
      ordens: totalOrdens,
      produtos: 0,
      servicos: 0,
      servicosComComissao: 0,
      total: 0,
      parcial: totalOrdens > linhas.length,
    };

    if (!ids.length) {
      return NextResponse.json(vazio, { headers: { "Cache-Control": "no-store" } });
    }

    const [produtosRes, servicosRes] = await Promise.all([
      supabaseAdmin.from("osproduto").select("subtotal").in("ordemservicoid", ids),
      supabaseAdmin
        .from("osservico")
        .select("subtotal, servico:servicoid ( gera_comissao )")
        .in("ordemservicoid", ids),
    ]);

    if (produtosRes.error) throw produtosRes.error;
    if (servicosRes.error) throw servicosRes.error;

    const produtos = (produtosRes.data ?? []).reduce(
      (acc, item) => acc + num((item as Record<string, unknown>).subtotal),
      0,
    );

    let servicos = 0;
    let servicosComComissao = 0;

    for (const item of servicosRes.data ?? []) {
      const registro = item as unknown as Record<string, unknown>;
      const subtotal = num(registro.subtotal);
      servicos += subtotal;

      const servico = Array.isArray(registro.servico) ? registro.servico[0] : registro.servico;
      const geraComissao = (servico as { gera_comissao?: boolean } | null)?.gera_comissao;
      // Serviço sem cadastro vinculado segue o default da coluna: gera comissão.
      if (geraComissao !== false) servicosComComissao += subtotal;
    }

    return NextResponse.json(
      {
        ordens: totalOrdens,
        produtos,
        servicos,
        servicosComComissao,
        // `orcamentototal` já embute desconto e acréscimo da OS, por isso pode
        // não ser a soma exata de produtos + serviços.
        total: linhas.reduce((acc, linha) => acc + num((linha as Record<string, unknown>).orcamentototal), 0),
        parcial: totalOrdens > linhas.length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return erroInterno("GET /api/me/ordens/indicadores", e);
  }
}
