export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireFinanceiroEdit } from "@/app/api/_authz/perms";
import { respostaSeEdicaoBloqueada } from "@/app/api/transaction/_lib/edicao";
import { auth } from "@/lib/auth";
import { modoDeReparcelamento } from "@/lib/financeiro/reparcelamento-modo";
import { MAXIMO_DE_PARCELAS } from "@/lib/financeiro/reparcelamento";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { exigirAcessoATransacao } from "../../_lib/autoria";

type Params = { params: Promise<{ id: string }> };

type ParcelaDoPedido = { valor: number; data: string };

/**
 * Reparcela: muda quantidade, valores e vencimentos das parcelas pendentes.
 *
 * A regra é do GRUPO, não da linha — por isso não dá para fazer isto com N
 * PATCHes. As parcelas baixadas ficam intactas e a numeração da descrição
 * precisa ser refeita de ponta a ponta; uma chamada falhando no meio deixaria o
 * parcelamento em dois estados ao mesmo tempo. Tudo acontece dentro de
 * `reparcelar_transacao`.
 *
 * Se a soma pode mudar depende do modo, e o modo vem do vínculo da transação —
 * ver `modoDeReparcelamento`. Num lançamento avulso o total é livre; com
 * documento ele é dado do documento e só a divisão muda.
 */

/**
 * O total pendente que a tela tinha na mão quando abriu o editor.
 *
 * No modo avulso a soma deixou de ser travada, e com ela foi embora a defesa
 * contra duas telas salvando uma por cima da outra — antes, a segunda errava
 * porque o alvo já não era o mesmo. Ausente ou ilegível vale `null`: o servidor
 * não inventa um total para conferir contra.
 */
function lerTotalAnterior(bruto: unknown): number | null {
  if (bruto == null || bruto === "") return null;
  const total = Number(bruto);
  return Number.isFinite(total) && total >= 0 ? Number(total.toFixed(2)) : null;
}

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
    await exigirAcessoATransacao(Number(id));
    if (!/^\d+$/.test(id) || id === "0") {
      return NextResponse.json({ error: "Transação inválida." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const parcelas = lerParcelas(body?.parcelas);

    // O grupo e o MODO vêm da transação aberta, não do cliente: aceitar um
    // `parcelamentoId` do corpo deixaria reparcelar um grupo qualquer a partir de
    // uma transação sem relação nenhuma com ele, e aceitar um modo deixaria
    // destravar o total de um documento só pedindo com jeitinho.
    const { data: transacao, error: transacaoError } = await supabaseAdmin
      .from("transacao")
      .select(
        "id, parcelamento_id, ordemservicoid, vendaid, entrada_id, usoconsumo_entrada_id, pagamento_multiplo_id, evento_financeiro_id, adiantamento_id, eh_adiantamento, transferencia_id",
      )
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle();

    if (transacaoError) throw transacaoError;
    if (!transacao) {
      return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
    }

    // Barrar aqui é só cortesia: a RPC refaz a mesma cascata sobre a linha
    // gravada. O ganho é a mensagem chegar sem custar uma ida ao banco.
    const classificacao = modoDeReparcelamento(transacao);
    if (classificacao.modo === "BLOQUEADO") {
      return NextResponse.json({ error: classificacao.motivo }, { status: 400 });
    }

    const session = await auth();
    const motivo = String(body?.motivo ?? "").trim().slice(0, 500);

    const { data, error } = await supabaseAdmin.rpc("reparcelar_transacao", {
      p_transacao_id: Number(id),
      p_parcelas: parcelas,
      p_alterado_por: (session?.user as { id?: string } | undefined)?.id ?? null,
      p_motivo: motivo || null,
      p_total_anterior: lerTotalAnterior(body?.totalAnterior),
    });

    if (error) {
      // A RPC devolve mensagens já prontas para o usuário nestes códigos.
      if (error.code === "22023") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === "P0002") {
        return NextResponse.json({ error: "Parcelamento não encontrado." }, { status: 404 });
      }
      // Todos são conflito de estado, não payload torto: 40001 alguém salvou
      // antes; 55P03 o grupo está travado por outra tela; 55000 histórico
      // imutável; 23514 o teto do documento, que a RPC não deveria deixar
      // escapar mas que continua sendo o gatilho a decidir.
      if (
        error.code === "40001" ||
        error.code === "55P03" ||
        error.code === "55000" ||
        error.code === "23514"
      ) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      // P0001 é o gate de status da OS. A RPC dispensa o gate no reparcelamento,
      // então chegar aqui significa que a regra mudou por outro caminho.
      if (error.code === "P0001") {
        return NextResponse.json({ error: error.message }, { status: 400 });
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
