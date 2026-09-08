export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { reanalisarMovimentosGravados, type MovimentoGravado } from "../_lib/analise";

type Params = { params: Promise<{ id: string }> };

const CAMPOS_MOVIMENTO =
  "id, sequencia, fitid, checknum, refnum, tipo_ofx, data_postagem, data_disponivel, valor, valor_centavos, nome, memo, fingerprint, status, situacao_analise, score_match, acao_conciliacao, observacao, transacao_id, titulo_origem_id, conciliado_em, conciliado_por";

/**
 * Uma importação e seus movimentos.
 *
 * As sugestões dos movimentos que continuam em aberto são recalculadas contra o
 * financeiro de agora — ver `reanalisarMovimentosGravados`.
 */
export async function GET(_req: Request, ctx: Params) {
  try {
    await requireFinanceirosAccess();

    const { id } = await ctx.params;
    if (!/^\d+$/.test(id) || id === "0") {
      return NextResponse.json({ error: "Importação inválida." }, { status: 400 });
    }

    const { data: importacao, error } = await supabaseAdmin
      .from("ofx_importacao")
      .select(
        "id, banco_id, arquivo_nome, arquivo_hash, bank_id_ofx, agencia_ofx, conta_ofx, tipo_conta_ofx, moeda, periodo_inicio, periodo_fim, saldo_inicial, saldo_final, quantidade_movimentos, quantidade_importados, quantidade_repetidos, created_at, created_by, banco:banco_id (id, titulo, agencia, contanumero)",
      )
      .eq("id", Number(id))
      .maybeSingle();

    if (error) throw error;
    if (!importacao) {
      return NextResponse.json({ error: "Importação não encontrada." }, { status: 404 });
    }

    const { data: linhas, error: erroMovimentos } = await supabaseAdmin
      .from("ofx_movimento")
      .select(CAMPOS_MOVIMENTO)
      .eq("importacao_id", Number(id))
      .order("sequencia", { ascending: true });

    if (erroMovimentos) throw erroMovimentos;

    const movimentos = await reanalisarMovimentosGravados(
      Number((importacao as any).banco_id),
      (linhas ?? []) as unknown as MovimentoGravado[],
    );

    return NextResponse.json({ data: { importacao, movimentos } });
  } catch (error: any) {
    const statusCode = Number(error?.statusCode ?? 500);
    if (statusCode === 401 || statusCode === 403) {
      return NextResponse.json({ error: error.message }, { status: statusCode });
    }

    console.error("GET /api/financeiro/conciliacao/ofx/[id]", error);
    return NextResponse.json(
      { error: "Não foi possível carregar a importação." },
      { status: 500 },
    );
  }
}
