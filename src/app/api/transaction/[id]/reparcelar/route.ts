export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireFinanceiroEdit } from "@/app/api/_authz/perms";
import { respostaSeEdicaoBloqueada } from "@/app/api/transaction/_lib/edicao";
import { auth } from "@/lib/auth";
import { MAXIMO_DE_PARCELAS } from "@/lib/financeiro/reparcelamento";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Params = { params: Promise<{ id: string }> };

type ParcelaDoPedido = { valor: number; data: string };

/**
 * Reparcela um lançamento avulso: muda quantidade, valores e vencimentos das
 * parcelas que ainda estão pendentes.
 *
 * A regra é do GRUPO, não da linha — por isso não dá para fazer isto com N
 * PATCHes. A soma das pendentes tem que continuar a mesma, as parcelas baixadas
 * ficam intactas e a numeração da descrição precisa ser refeita de ponta a ponta;
 * uma chamada falhando no meio deixaria o parcelamento em dois estados ao mesmo
 * tempo. Tudo acontece dentro de `reparcelar_transacao_avulsa`.
 */

function lerParcelas(bruto: unknown): ParcelaDoPedido[] {
  if (!Array.isArray(bruto) || bruto.length === 0) {
    throw new Error("Informe ao menos uma parcela.");
  }

  if (bruto.length > MAXIMO_DE_PARCELAS) {
    throw new Error(`Um parcelamento pode ter no máximo ${MAXIMO_DE_PARCELAS} parcelas.`);
  }

  return bruto.map((item, indice) => {
    const registro = (item ?? {}) as Record<string, unknown>;
    const valor = Number(registro.valor);

    if (!Number.isFinite(valor) || valor <= 0) {
      throw new Error(`Informe um valor maior que zero na parcela ${indice + 1}.`);
    }

    const data = new Date(String(registro.data ?? ""));
    if (Number.isNaN(data.getTime())) {
      throw new Error(`Informe o vencimento da parcela ${indice + 1}.`);
    }

    return { valor: Number(valor.toFixed(2)), data: data.toISOString() };
  });
}

export async function POST(req: NextRequest, ctx: Params) {
  try {
    await requireFinanceiroEdit();

    const bloqueio = await respostaSeEdicaoBloqueada();
    if (bloqueio) return bloqueio;

    const { id } = await ctx.params;
    if (!/^\d+$/.test(id) || id === "0") {
      return NextResponse.json({ error: "Transação inválida." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const parcelas = lerParcelas(body?.parcelas);

    // O grupo vem da transação aberta, não do cliente: aceitar um
    // `parcelamentoId` do corpo deixaria reparcelar um grupo qualquer a partir de
    // uma transação sem relação nenhuma com ele.
    const { data: transacao, error: transacaoError } = await supabaseAdmin
      .from("transacao")
      .select("id, parcelamento_id")
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle();

    if (transacaoError) throw transacaoError;
    if (!transacao) {
      return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
    }

    if (transacao.parcelamento_id == null) {
      return NextResponse.json(
        {
          error:
            "Esta transação não faz parte de um parcelamento avulso, ou o grupo dela é anterior ao registro de parcelamentos.",
        },
        { status: 400 },
      );
    }

    const session = await auth();
    const motivo = String(body?.motivo ?? "").trim().slice(0, 500);

    const { data, error } = await supabaseAdmin.rpc("reparcelar_transacao_avulsa", {
      p_parcelamento_id: transacao.parcelamento_id,
      p_parcelas: parcelas,
      p_alterado_por: (session?.user as { id?: string } | undefined)?.id ?? null,
      p_motivo: motivo || null,
    });

    if (error) {
      // A RPC devolve mensagens já prontas para o usuário nestes códigos.
      if (error.code === "22023") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === "P0002") {
        return NextResponse.json({ error: "Parcelamento não encontrado." }, { status: 404 });
      }
      // 40001: alguém salvou antes; 55000: histórico imutável.
      if (error.code === "40001" || error.code === "55000") {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ data });
  } catch (error: unknown) {
    const erro = error as { statusCode?: number; message?: string };
    const statusAutorizacao = Number(erro?.statusCode);
    const status =
      statusAutorizacao === 401 || statusAutorizacao === 403
        ? statusAutorizacao
        : erro?.message?.includes("parcela") || erro?.message?.includes("Informe")
          ? 400
          : 500;

    return NextResponse.json(
      { error: erro?.message ?? "Não foi possível reparcelar." },
      { status },
    );
  }
}
