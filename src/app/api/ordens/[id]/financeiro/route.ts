export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import {
  requireFinanceirosAccess,
  requireOSAccess,
} from "@/app/api/_authz/perms";
import { calcularResumoFinanceiroOs } from "@/lib/ordens/financeiro";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Params = { params: Promise<{ id: string }> };

/**
 * Fatia desta OS em cada transação de pagamento múltiplo que a cobre.
 *
 * A transação de um pagamento múltiplo não aponta para OS nenhuma — ela é o
 * dinheiro, e cobre vários documentos. O elo, e o quanto coube a cada um, está
 * no rateio.
 */
async function fatiasDaOs(osId: number) {
  const { data, error } = await supabaseAdmin
    .from("pagamento_multiplo_rateio")
    .select("transacao_id, valor")
    .eq("tipo_documento", "OS")
    .eq("documento_id", osId);
  if (error) throw error;

  return new Map<number, number>(
    (data ?? []).map((linha: any) => [Number(linha.transacao_id), Number(linha.valor ?? 0)]),
  );
}

export async function GET(_: Request, { params }: Params) {
  try {
    await requireOSAccess();
    await requireFinanceirosAccess();

    const osId = Number((await params).id);
    if (!Number.isInteger(osId) || osId <= 0) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const fatiaPorTransacao = await fatiasDaOs(osId);
    const idsRateados = [...fatiaPorTransacao.keys()];

    const [ordemResult, transacoesResult] = await Promise.all([
      supabaseAdmin
        .from("ordemservico")
        .select("id, status, orcamentototal, acrescimo_financeiro_tipo, acrescimo_financeiro_valor")
        .eq("id", osId)
        .eq("is_deleted", false)
        .maybeSingle(),
      supabaseAdmin
        .from("transacao")
        .select(`
          id, descricao, descricao_pagamento, valor, valorLiquido, valor_base,
          valor_acrescimos, valor_descontos, data, vencimento_em, pago_em,
          metodopagamento, categoria, categoria_id, plano_de_conta,
          plano_de_conta_id, centro_custo, centro_custo_id, tipo, pendente,
          cliente_id, banco_id, ordemservicoid, evento_financeiro_id,
          created_at, updated_at, pagamento_multiplo_id,
          banco:bancoconta!transacao_banco_id_fkey ( id, titulo ),
          pagamento_multiplo:pagamento_multiplo_id (
            id, descricao, modo, valor_total, data
          )
        `)
        .or(`ordemservicoid.eq.${osId},id.in.(${idsRateados.join(",") || 0})`)
        .eq("tipo", "RECEITA")
        .is("evento_financeiro_id", null)
        .eq("is_deleted", false)
        .order("data", { ascending: false })
        .order("id", { ascending: false }),
    ]);

    if (ordemResult.error) throw ordemResult.error;
    if (!ordemResult.data) {
      return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
    }
    if (transacoesResult.error) throw transacoesResult.error;

    // Quantos documentos cada pagamento múltiplo cobre. Sem isso o painel diria
    // "parte de um pagamento de R$ 1.000" sem responder a pergunta seguinte, que
    // é sempre "rateado com o quê?".
    const gruposIds = [
      ...new Set(
        (transacoesResult.data ?? [])
          .map((transacao: any) => transacao.pagamento_multiplo_id)
          .filter((id: unknown): id is number => id != null),
      ),
    ];

    const documentosPorGrupo = new Map<number, number>();
    if (gruposIds.length > 0) {
      const { data: linhasDoGrupo, error: erroGrupo } = await supabaseAdmin
        .from("pagamento_multiplo_rateio")
        .select("pagamento_multiplo_id, tipo_documento, documento_id")
        .in("pagamento_multiplo_id", gruposIds);
      if (erroGrupo) throw erroGrupo;

      const vistos = new Map<number, Set<string>>();
      for (const linha of (linhasDoGrupo ?? []) as any[]) {
        const grupo = Number(linha.pagamento_multiplo_id);
        const conjunto = vistos.get(grupo) ?? new Set<string>();
        conjunto.add(`${linha.tipo_documento}:${linha.documento_id}`);
        vistos.set(grupo, conjunto);
      }
      for (const [grupo, conjunto] of vistos) documentosPorGrupo.set(grupo, conjunto.size);
    }

    const transacoes = (transacoesResult.data ?? []).map((transacao: any) => {
      // Na transação de pagamento múltiplo, o valor da linha é o recebimento
      // inteiro — que cobre outras OS. Para esta OS vale a fatia dela; sem essa
      // troca o painel mostraria como recebido um dinheiro que foi de outro
      // documento, e o resumo passaria do total devido.
      const fatia = fatiaPorTransacao.get(Number(transacao.id));
      const valor = fatia ?? Number(transacao.valor ?? 0);

      return {
        ...transacao,
        valor,
        valorLiquido: fatia ?? Number(transacao.valorLiquido ?? transacao.valor ?? 0),
        valor_base: fatia ?? Number(transacao.valor_base ?? transacao.valor ?? 0),
        valor_acrescimos: fatia != null ? 0 : Number(transacao.valor_acrescimos ?? 0),
        valor_descontos: fatia != null ? 0 : Number(transacao.valor_descontos ?? 0),
        pendente: transacao.pendente === true,
        valor_rateado: fatia != null,
        pagamento_multiplo: transacao.pagamento_multiplo
          ? {
              ...transacao.pagamento_multiplo,
              valor_total: Number(transacao.pagamento_multiplo.valor_total ?? 0),
              documentos: documentosPorGrupo.get(Number(transacao.pagamento_multiplo_id)) ?? 1,
            }
          : null,
      };
    });
    const resumo = calcularResumoFinanceiroOs({
      totalComercial: ordemResult.data.orcamentototal,
      acrescimoFinanceiroTipo: ordemResult.data.acrescimo_financeiro_tipo,
      acrescimoFinanceiroValor: ordemResult.data.acrescimo_financeiro_valor,
      transacoes,
    });

    return NextResponse.json(
      {
        ordem: { id: ordemResult.data.id, status: ordemResult.data.status },
        resumo,
        transacoes,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    const statusCode = Number(error?.statusCode ?? 500);
    const status = statusCode === 401 || statusCode === 403 ? statusCode : 500;
    return NextResponse.json(
      { error: error?.message ?? "Não foi possível carregar o financeiro da OS." },
      { status },
    );
  }
}
