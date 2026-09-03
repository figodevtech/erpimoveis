export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { requireOSEdit } from "@/app/api/_authz/perms";
import { filtrarTransacoesExcluiveisDaOs } from "@/app/api/ordens/_lib/exclusao-financeira";
import { valorDeFace } from "@/lib/financeiro/transacao";
import { listarConsumosDaOs } from "@/lib/ordens/consumo-estoque";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    await requireOSEdit();
    const osId = Number((await params).id);
    if (!Number.isInteger(osId) || osId <= 0) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const ordem = await supabaseAdmin
      .from("ordemservico")
      .select("id")
      .eq("id", osId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (ordem.error) throw ordem.error;
    if (!ordem.data) {
      return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
    }

    const consulta = filtrarTransacoesExcluiveisDaOs(
      supabaseAdmin
        .from("transacao")
        .select(`
          id, descricao, descricao_pagamento, valor, valor_acrescimos,
          valor_descontos, valorLiquido, data, vencimento_em, pago_em,
          metodopagamento, pendente, adiantamento_id, eh_adiantamento,
          banco:bancoconta!transacao_banco_id_fkey ( id, titulo )
        `),
      osId,
    )
      .order("pendente", { ascending: true })
      .order("data", { ascending: false })
      .order("id", { ascending: false });
    const { data, error } = await consulta;
    if (error) throw error;

    const transacoes = (data ?? []).map((transacao: any) => ({
      ...transacao,
      id: String(transacao.id),
      adiantamento_id:
        transacao.adiantamento_id == null ? null : String(transacao.adiantamento_id),
      valor: Number(transacao.valor ?? 0),
      valor_acrescimos: Number(transacao.valor_acrescimos ?? 0),
      valor_descontos: Number(transacao.valor_descontos ?? 0),
      valorLiquido: Number(transacao.valorLiquido ?? transacao.valor ?? 0),
      valorFace: valorDeFace(transacao),
      pendente: transacao.pendente === true,
    }));
    const valorRecebido = transacoes
      .filter((transacao: any) => !transacao.pendente)
      .reduce((total: number, transacao: any) => total + transacao.valorFace, 0);
    const valorPendente = transacoes
      .filter((transacao: any) => transacao.pendente)
      .reduce((total: number, transacao: any) => total + transacao.valorFace, 0);

    // O cancelamento tambem devolve consumo de estoque ao inventario. Quem vai
    // cancelar precisa ver isso na mesma tela em que ve as transacoes — inclusive
    // o que NAO volta, por ja ter transacao vinculada.
    const consumos = await listarConsumosDaOs(osId);

    return NextResponse.json(
      {
        osId,
        transacoes,
        consumos,
        resumo: {
          quantidade: transacoes.length,
          valorRecebido: Math.round(valorRecebido * 100) / 100,
          valorPendente: Math.round(valorPendente * 100) / 100,
          valorTotal: Math.round((valorRecebido + valorPendente) * 100) / 100,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    const statusCode = Number(error?.statusCode ?? 500);
    const status = statusCode === 401 || statusCode === 403 ? statusCode : 500;
    return NextResponse.json(
      { error: error?.message ?? "Não foi possível verificar as transações da OS." },
      { status },
    );
  }
}
