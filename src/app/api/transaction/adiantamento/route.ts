export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireFinanceiroEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { exigirAcessoATransacao, exigirLeituraDeTransacao } from "../_lib/autoria";

/**
 * Baixa por adiantamento: várias parcelas liquidadas por um único movimento.
 *
 * Toda a regra vive na RPC `baixar_por_adiantamento`, que faz a coisa inteira
 * numa transação só — criar o lançamento da antecipação, quitar as parcelas,
 * apontá-las para ele e lançar a taxa. Diferente da baixa em lote comum, aqui é
 * tudo ou nada: uma parcela fora do conjunto apareceria em aberto tendo sido
 * paga, e o adiantamento cobriria valor que ninguém deve.
 */

const LIMITE = 200;

export async function POST(req: NextRequest) {
  try {
    await requireFinanceiroEdit();

    const body = await req.json().catch(() => ({}));
    const ids: unknown = body?.ids;
    const dataPagamento = String(body?.dataPagamento ?? "");
    const bancoId = Number(body?.bancoId);
    const metodoPagamento = String(body?.metodoPagamento ?? "");
    const taxa = Number(body?.taxa ?? 0);

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "Selecione ao menos uma transação." }, { status: 400 });
    }
    if (ids.length > LIMITE) {
      return NextResponse.json(
        { error: `Antecipe no máximo ${LIMITE} títulos por vez.` },
        { status: 400 },
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataPagamento)) {
      return NextResponse.json({ error: "Informe uma data válida." }, { status: 400 });
    }
    if (!Number.isSafeInteger(bancoId) || bancoId <= 0 || !metodoPagamento) {
      return NextResponse.json(
        { error: "Banco e método de pagamento são obrigatórios." },
        { status: 400 },
      );
    }
    if (!Number.isFinite(taxa) || taxa < 0) {
      return NextResponse.json(
        { error: "A taxa de antecipação não pode ser negativa." },
        { status: 400 },
      );
    }

    const limpos = [
      ...new Set(ids.map((id) => Number(id)).filter((id) => Number.isSafeInteger(id) && id > 0)),
    ];
    if (limpos.length === 0) {
      return NextResponse.json({ error: "Nenhuma transação válida." }, { status: 400 });
    }
    await exigirAcessoATransacao(limpos);

    // Meio-dia no fuso do Brasil, mesma regra da baixa individual: a data chega
    // como dia puro e precisa cair no dia certo depois da conversão.
    const pagoEm = new Date(`${dataPagamento}T12:00:00-03:00`);
    if (Number.isNaN(pagoEm.getTime())) {
      return NextResponse.json({ error: "Informe uma data válida." }, { status: 400 });
    }

    const session = await auth().catch(() => null);

    /*
     * Sem categoria informada, o lançamento cai na de sistema da antecipação —
     * a mesma ideia das categorias de OS e venda. Deixar em branco jogaria em
     * "NÃO RELACIONADO" justamente o lançamento que concentra o dinheiro de
     * vários títulos, e ele sumiria no meio dos avulsos.
     */
    let categoriaId = body?.categoriaId ?? null;
    if (categoriaId == null) {
      const { data: categoria } = await supabaseAdmin
        .from("categoriatransacao")
        .select("id")
        .eq("codigo_sistema", "ADIANTAMENTO")
        .maybeSingle();
      categoriaId = categoria?.id ?? null;
    }

    const { data, error } = await supabaseAdmin.rpc("baixar_por_adiantamento", {
      p_ids: limpos,
      p_adiantamento: {
        banco_id: bancoId,
        metodopagamento: metodoPagamento,
        pago_em: pagoEm.toISOString(),
        taxa,
        descricao: body?.descricao ?? null,
        descricao_pagamento: body?.descricaoPagamento ?? null,
        categoria_id: categoriaId,
        plano_de_conta_id: body?.planoContaId ?? null,
        centro_custo_id: body?.centroCustoId ?? null,
        cliente_id: body?.clienteId ?? null,
        fornecedor_id: body?.fornecedorId ?? null,
        nomepagador: body?.nomePagador ?? null,
        cpfcnpjpagador: body?.cpfCnpjPagador ?? null,
        // Antecipação de boleto: o dinheiro entra, mas o título fica em aberto
        // para a cobrança acompanhar até o vencimento.
        manter_titulos_pendentes: body?.manterTitulosPendentes === true,
      },
      p_baixado_por: (session?.user as { id?: string } | undefined)?.id ?? null,
    });

    if (error) {
      // A RPC já escreve mensagens prontas para quem está usando.
      if (error.code === "22023" || error.code === "23505") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === "P0002") {
        return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
      }
      if (error.code === "23503") {
        return NextResponse.json(
          { error: "Banco, plano de conta ou centro de custo inválido." },
          { status: 422 },
        );
      }
      throw error;
    }

    return NextResponse.json({ data });
  } catch (error: unknown) {
    const erro = error as { statusCode?: number; message?: string };
    const status = Number(erro?.statusCode);
    return NextResponse.json(
      { error: erro?.message ?? "Não foi possível registrar o adiantamento." },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}

/** Lista as parcelas que um adiantamento liquidou, para a aba do dialog. */
export async function GET(req: NextRequest) {
  try {
    await requireFinanceiroEdit();

    const id = Number(new URL(req.url).searchParams.get("transacaoId"));
    if (!Number.isSafeInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Transação inválida." }, { status: 400 });
    }

    const { data: atual, error: atualError } = await supabaseAdmin
      .from("transacao")
      .select("id, eh_adiantamento, adiantamento_id, valor, valorLiquido, valor_descontos, descricao")
      .eq("id", id)
      .maybeSingle();

    if (atualError) throw atualError;
    if (!atual) return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
    await exigirLeituraDeTransacao(id);

    // A aba serve aos dois lados: quem antecipou (lista as parcelas) e a parcela
    // antecipada (mostra o lançamento que trouxe o dinheiro).
    const alvo = atual.eh_adiantamento ? atual.id : atual.adiantamento_id;
    if (!alvo) return NextResponse.json({ data: { adiantamento: null, parcelas: [] } });

    const [{ data: adiantamento }, { data: parcelas }] = await Promise.all([
      supabaseAdmin
        .from("transacao")
        .select(
          'id, descricao, valor, "valorLiquido", valor_descontos, data, pago_em, tipo, banco:bancoconta!transacao_banco_id_fkey ( id, titulo )',
        )
        .eq("id", alvo)
        .maybeSingle(),
      supabaseAdmin
        .from("transacao")
        // `pendente` e `valor_baixado` separam os três estados que a aba mostra
        // no modo que mantém os títulos em aberto: aguardando o vencimento,
        // baixado sem mover a conta, ou baixado com dinheiro entrando — este
        // último reconhecido pelo `valor_baixado`, que é a soma das transações
        // de repasse ligadas ao título.
        .select(
          'id, descricao, descricao_pagamento, valor, "valorLiquido", valor_descontos, valor_baixado, data, vencimento_em, tipo, pendente, banco_id, adiantamento_id',
        )
        .eq("adiantamento_id", alvo)
        .eq("is_deleted", false)
        .order("data", { ascending: true }),
    ]);

    return NextResponse.json({
      data: { adiantamento, parcelas: parcelas ?? [], ehOAdiantamento: atual.eh_adiantamento },
    });
  } catch (error: unknown) {
    const erro = error as { statusCode?: number; message?: string };
    const status = Number(erro?.statusCode);
    return NextResponse.json(
      { error: erro?.message ?? "Não foi possível carregar o adiantamento." },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}
