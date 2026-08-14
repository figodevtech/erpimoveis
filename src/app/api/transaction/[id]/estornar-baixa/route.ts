export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireFinanceiroEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Params = { params: Promise<{ id: string }> };

/**
 * Tira a transação do fluxo de caixa.
 *
 * É a operação que faltava para corrigir uma baixa errada. Antes dela o caminho
 * era excluir e lançar de novo — o que, num título avulso ou migrado, apagava a
 * própria dívida junto com o pagamento.
 *
 * Fica em `requireFinanceiroEdit`, como a baixa: as duas são o mesmo par de
 * mãos mexendo no mesmo estado do título. Excluir continua sendo outra
 * permissão, e agora só alcança título que já não tem pagamento.
 */
export async function POST(_: Request, ctx: Params) {
  try {
    await requireFinanceiroEdit();
    const sessao = await auth().catch(() => null);
    const { id } = await ctx.params;

    if (!/^\d+$/.test(id) || id === "0") {
      return NextResponse.json({ error: "Transação inválida." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc("estornar_baixa_transacao", {
      p_transacao_id: id,
      p_estornado_por: (sessao?.user as { id?: string } | undefined)?.id ?? null,
    });

    if (error) {
      // P0002 é "não encontrada"; 22023 são as recusas de regra, e cada uma já
      // traz na mensagem qual operação desfaz aquele conjunto.
      const status = error.code === "P0002" ? 404 : error.code === "22023" ? 409 : 500;
      if (status === 500) throw error;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({ data });
  } catch (error: unknown) {
    const erro = error as { message?: string; statusCode?: number };
    const statusCode = Number(erro?.statusCode);
    const status = statusCode === 401 || statusCode === 403 ? statusCode : 500;
    return NextResponse.json(
      { error: erro?.message ?? "Não foi possível tirar a transação do fluxo de caixa." },
      { status },
    );
  }
}
