export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireFinanceiroEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Params) {
  try {
    await requireFinanceiroEdit();
    const session = await auth();
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id) || id === "0") {
      return NextResponse.json({ error: "Transação inválida." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const dataPagamento = String(body?.dataPagamento ?? "").trim();
    const bancoId = Number(body?.bancoId);
    const metodoPagamento = String(body?.metodoPagamento ?? "").trim();
    const planoContaId = body?.planoContaId == null ? null : Number(body.planoContaId);
    const centroCustoId = body?.centroCustoId == null ? null : Number(body.centroCustoId);
    /*
     * Só título antecipado responde a isto, e só ele oferece a pergunta na tela.
     *
     * Antecipado e honrado no vencimento, a baixa não move a conta: o dinheiro
     * entrou pela antecipação, e gravar o banco de novo somaria o mesmo valor
     * duas vezes. Quando o pagador não paga, porém, o banco debita o valor de
     * volta — e se o devedor quitar depois, aquela baixa é entrada de verdade.
     * Só quem operou sabe em qual dos dois está, então a tela pergunta.
     *
     * O padrão é `false`: o caso comum é o boleto honrado, e quem chamar sem o
     * campo recebe o comportamento de sempre.
     */
    const lancarNoCaixa = body?.lancarNoCaixa === true;
    /*
     * Baixa parcial: quanto deste título está sendo pago agora.
     *
     * Ausente é o comportamento de sempre — baixa o saldo inteiro. Menor que o
     * saldo cria uma transação com o dinheiro, ligada ao título, que segue aberto
     * pelo que falta. Quem valida o teto é a RPC, que é onde o saldo está.
     */
    const valorBruto = body?.valor;
    const valor =
      valorBruto == null || valorBruto === "" ? null : Number(valorBruto);
    if (valor != null && (!Number.isFinite(valor) || valor <= 0)) {
      return NextResponse.json(
        { error: "O valor da baixa deve ser um número maior que zero." },
        { status: 400 },
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataPagamento)) {
      return NextResponse.json({ error: "Informe uma data de pagamento válida." }, { status: 400 });
    }
    const pagoEm = new Date(`${dataPagamento}T12:00:00-03:00`);
    if (Number.isNaN(pagoEm.getTime())) {
      return NextResponse.json({ error: "Informe uma data de pagamento válida." }, { status: 400 });
    }
    if (!Number.isSafeInteger(bancoId) || bancoId <= 0 || !metodoPagamento) {
      return NextResponse.json({ error: "Banco e método de pagamento são obrigatórios." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc("baixar_transacao_pendente", {
      p_transacao_id: id,
      p_pago_em: pagoEm.toISOString(),
      p_banco_id: bancoId,
      p_metodopagamento: metodoPagamento,
      p_plano_de_conta_id: Number.isSafeInteger(planoContaId) ? planoContaId : null,
      p_centro_custo_id: Number.isSafeInteger(centroCustoId) ? centroCustoId : null,
      p_baixado_por: (session?.user as any)?.id ?? null,
      p_lancar_no_caixa: lancarNoCaixa,
      p_valor: valor,
    });

    if (error) {
      if (error.code === "23505" || error.message.includes("ja foi baixada")) {
        return NextResponse.json({ error: "Esta transação já foi baixada." }, { status: 409 });
      }
      // A RPC recusa a bandeira em título comum com mensagem pronta, e o mesmo
      // código cobre as demais recusas de regra dela.
      if (error.code === "22023") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === "P0002") {
        return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
      }
      if (error.code === "23503") {
        return NextResponse.json({ error: "Banco, plano de conta ou centro de custo inválido." }, { status: 422 });
      }
      throw error;
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    const statusCode = Number(error?.statusCode ?? 500);
    const status = statusCode === 401 || statusCode === 403 ? statusCode : 500;
    return NextResponse.json(
      { error: error?.message ?? "Não foi possível baixar a transação." },
      { status },
    );
  }
}
