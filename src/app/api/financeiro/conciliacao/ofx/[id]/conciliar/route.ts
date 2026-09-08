export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requireFinanceiroCreate, requireFinanceiroEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ACOES_DE_EDICAO, aplicarDecisao, normalizarDecisao } from "../../_lib/conciliar";

type Params = { params: Promise<{ id: string }> };

/**
 * Resolve os movimentos que ficaram em aberto numa importação já gravada.
 *
 * Mesmo caminho da confirmação em massa: uma chamada à RPC atômica por
 * movimento. A permissão acompanha a operação — vincular e liquidar mexem em
 * transação existente e pedem edição; criar e ignorar pedem criação.
 */
export async function POST(req: Request, ctx: Params) {
  try {
    const session = await auth();
    const usuarioId = ((session?.user as any)?.id as string | undefined) ?? null;

    const { id } = await ctx.params;
    if (!/^\d+$/.test(id) || id === "0") {
      return NextResponse.json({ error: "Importação inválida." }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const brutas = Array.isArray(body?.decisoes) ? body.decisoes : body ? [body] : [];
    if (brutas.length === 0) {
      return NextResponse.json({ error: "Nenhuma decisão foi enviada." }, { status: 400 });
    }

    const decisoes = brutas.map(normalizarDecisao);
    if (decisoes.some((decisao: unknown) => decisao == null)) {
      return NextResponse.json(
        { error: "As decisões de conciliação vieram em formato inválido." },
        { status: 400 },
      );
    }

    await requireFinanceiroCreate();
    if (decisoes.some((decisao: any) => ACOES_DE_EDICAO.has(decisao.acao))) {
      await requireFinanceiroEdit();
    }

    /*
     * O movimento tem que ser desta importação. Sem esta conferência, a rota
     * viraria um caminho para conciliar qualquer linha do sistema por um id de
     * importação qualquer — a RPC valida a operação, não a rota de onde veio.
     */
    const idsPedidos = decisoes
      .map((decisao: any) => Number(decisao.movimentoId))
      .filter((valor: number) => Number.isSafeInteger(valor) && valor > 0);

    if (idsPedidos.length !== decisoes.length) {
      return NextResponse.json(
        { error: "Informe o movimento do extrato a conciliar." },
        { status: 400 },
      );
    }

    const { data: existentes, error } = await supabaseAdmin
      .from("ofx_movimento")
      .select("id")
      .eq("importacao_id", Number(id))
      .in("id", idsPedidos);

    if (error) throw error;

    const permitidos = new Set((existentes ?? []).map((linha) => Number(linha.id)));
    if (idsPedidos.some((movimentoId: number) => !permitidos.has(movimentoId))) {
      return NextResponse.json(
        { error: "Algum movimento informado não pertence a esta importação." },
        { status: 400 },
      );
    }

    const resultados = [];
    for (const decisao of decisoes as any[]) {
      resultados.push(await aplicarDecisao(Number(decisao.movimentoId), decisao, usuarioId));
    }

    return NextResponse.json({
      data: {
        conciliados: resultados.filter((resultado) => resultado.ok).length,
        falhas: resultados.filter((resultado) => !resultado.ok),
        resultados,
      },
    });
  } catch (error: any) {
    const statusCode = Number(error?.statusCode ?? 500);
    if (statusCode === 401 || statusCode === 403) {
      return NextResponse.json({ error: error.message }, { status: statusCode });
    }

    console.error("POST /api/financeiro/conciliacao/ofx/[id]/conciliar", error);
    return NextResponse.json(
      { error: "Não foi possível conciliar os movimentos." },
      { status: 500 },
    );
  }
}
