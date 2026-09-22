export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { exigirAcessoATransacao } from "../../_lib/autoria";

type Params = { params: Promise<{ id: string }> };

/**
 * De quem é este título e quanto de crédito essa pessoa tem.
 *
 * Existe para o diálogo de baixa poder mostrar o saldo ANTES de confirmar, em
 * vez de o usuário descobrir que não dava por uma mensagem de erro depois de
 * clicar.
 *
 * A resolução do dono mora aqui, no servidor, com a mesma precedência da view
 * `transacao_cliente` e da RPC `baixar_com_credito_cliente`
 * (`cliente_id` → OS → venda). Repeti-la no client criaria uma segunda resposta
 * para a mesma pergunta, que divergiria na primeira mudança de regra.
 */
export async function GET(_: Request, ctx: Params) {
  try {
    await requireFinanceirosAccess();
    const { id: raw } = await ctx.params;
    const id = Number(raw);
    await exigirAcessoATransacao(id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Transação inválida." }, { status: 400 });
    }

    const { data: transacao, error } = await supabaseAdmin
      .from("transacao")
      .select("id, tipo, cliente_id, ordemservicoid, vendaid, valor, valorLiquido, valor_baixado")
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle();

    if (error) throw error;
    if (!transacao) {
      return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
    }

    const ehReceita = String(transacao.tipo ?? "").toUpperCase() === "RECEITA";
    let clienteId = transacao.cliente_id as number | null;

    // Só receita herda o cliente do documento: numa despesa o vínculo com a OS
    // é do fornecedor, não do cliente.
    if (clienteId == null && ehReceita) {
      if (transacao.ordemservicoid != null) {
        const { data: os } = await supabaseAdmin
          .from("ordemservico")
          .select("clienteid")
          .eq("id", transacao.ordemservicoid)
          .maybeSingle();
        clienteId = (os?.clienteid as number | null) ?? null;
      }
      if (clienteId == null && transacao.vendaid != null) {
        const { data: venda } = await supabaseAdmin
          .from("venda")
          .select("clienteid")
          .eq("id", transacao.vendaid)
          .maybeSingle();
        clienteId = (venda?.clienteid as number | null) ?? null;
      }
    }

    const liquido = Number(transacao.valorLiquido ?? 0) || Number(transacao.valor ?? 0) || 0;
    const valorTitulo = Math.round(liquido * 100) / 100;

    if (clienteId == null) {
      return NextResponse.json({
        data: { clienteId: null, nome: null, saldo: 0, valorTitulo, suficiente: false, sentido: ehReceita ? "DEBITO" : "CREDITO" },
      });
    }

    const { data: cliente } = await supabaseAdmin
      .from("cliente")
      .select("id, nomerazaosocial, saldo_credito")
      .eq("id", clienteId)
      .maybeSingle();

    const saldo = Number(cliente?.saldo_credito ?? 0);

    return NextResponse.json({
      data: {
        clienteId,
        nome: cliente?.nomerazaosocial ?? null,
        saldo,
        valorTitulo,
        // Numa despesa o crédito é gerado, não consumido: não há saldo a exigir.
        suficiente: ehReceita ? saldo >= valorTitulo : true,
        sentido: ehReceita ? "DEBITO" : "CREDITO",
      },
    });
  } catch (error: any) {
    const statusCode = Number(error?.statusCode ?? 500);
    const status = statusCode === 401 || statusCode === 403 ? statusCode : 500;
    return NextResponse.json(
      { error: error?.message ?? "Não foi possível consultar o crédito do cliente." },
      { status },
    );
  }
}
