export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requireFinanceiroCreate, requireFinanceiroEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { contextoDeAutoria } from "@/app/api/transaction/_lib/autoria";
import {
  ACOES_DE_EDICAO,
  aplicarDecisao,
  validarAcessoDasDecisoes,
  idsDaDecisao,
  normalizarDecisao,
} from "../../_lib/conciliar";

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
    const idsPorDecisao = decisoes.map((decisao: any) => idsDaDecisao(decisao));

    if (idsPorDecisao.some((ids: number[]) => ids.length === 0)) {
      return NextResponse.json(
        { error: "Informe o movimento do extrato a conciliar." },
        { status: 400 },
      );
    }

    /*
     * Um grupo chega inteiro ou não chega.
     *
     * Se as fingerprints dizem duas linhas e vieram os ids de uma, conciliar
     * "o que deu" fecharia o lançamento com metade do dinheiro — e a soma que a
     * RPC confere seria a de um conjunto que o usuário não escolheu.
     */
    const grupoIncompleto = (decisoes as any[]).some(
      (decisao, indice) =>
        (decisao.grupo?.length ?? 0) > 1 &&
        idsPorDecisao[indice].length !== decisao.grupo.length,
    );
    if (grupoIncompleto) {
      return NextResponse.json(
        { error: "As linhas conciliadas juntas vieram incompletas." },
        { status: 400 },
      );
    }

    /*
     * A mesma linha não pode entrar em duas decisões do mesmo envio.
     *
     * A RPC recusaria a segunda ("já foi resolvido"), mas só depois de aplicar a
     * primeira — e o usuário veria metade do lote gravado com um erro que ele
     * não provocou de propósito. Barrar antes deixa o envio inteiro intacto.
     */
    const idsPedidos = idsPorDecisao.flat();
    if (new Set(idsPedidos).size !== idsPedidos.length) {
      return NextResponse.json(
        { error: "O mesmo movimento do extrato aparece em mais de uma decisão." },
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

    const contexto = await contextoDeAutoria();
    await validarAcessoDasDecisoes(decisoes, contexto);
    const resultados = [];
    for (const [indice, decisao] of (decisoes as any[]).entries()) {
      resultados.push(await aplicarDecisao(idsPorDecisao[indice], decisao, usuarioId, contexto));
    }

    return NextResponse.json({
      data: {
        // Linhas do extrato, nao atos: uma conciliacao N:1 resolve duas de uma vez,
        // e a tela diz "movimentos processados".
        conciliados: resultados
          .filter((resultado) => resultado.ok)
          .reduce((total, resultado) => total + resultado.movimentoIds.length, 0),
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
