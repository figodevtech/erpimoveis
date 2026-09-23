export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireFinanceiroEdit } from "@/app/api/_authz/perms";
import { respostaSeEdicaoBloqueada } from "@/app/api/transaction/_lib/edicao";
import { sincronizarTaxaRecebimento } from "@/app/api/transaction/_lib/taxa";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { exigirAcessoATransacao } from "../../_lib/autoria";

type Params = { params: Promise<{ id: string }> };

type ItemAjuste = {
  id: number;
  valor: number;
  valorLiquido: number;
  /** O que estava na tela quando ela abriu — a RPC recusa se já tiver mudado. */
  valorAnterior: number;
  valorLiquidoAnterior: number;
};

/**
 * Ajusta os valores bruto/liquido de um grupo de pagamentos de uma so vez.
 *
 * Existe separado do PATCH porque a regra e do GRUPO, nao da linha: quando os
 * lancamentos pertencem a uma OS ou venda, a soma dos brutos precisa continuar
 * a mesma. Garantir isso com N chamadas PATCH deixaria o documento inconsistente
 * se uma delas falhasse — a validacao e a escrita acontecem dentro da RPC.
 */

function lerItens(bruto: unknown): ItemAjuste[] {
  if (!Array.isArray(bruto) || bruto.length === 0) {
    throw new Error("Informe ao menos uma transação para ajustar.");
  }

  return bruto.map((item, indice) => {
    const registro = (item ?? {}) as Record<string, unknown>;
    const id = Number(registro.id);
    const valor = Number(registro.valor);
    const valorLiquido =
      registro.valorLiquido == null ? valor : Number(registro.valorLiquido);

    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error(`Transação inválida na linha ${indice + 1}.`);
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      throw new Error(`Informe um valor bruto maior que zero na linha ${indice + 1}.`);
    }
    if (!Number.isFinite(valorLiquido) || valorLiquido <= 0) {
      throw new Error(`Informe um valor líquido maior que zero na linha ${indice + 1}.`);
    }
    if (Math.round(valorLiquido * 100) > Math.round(valor * 100)) {
      throw new Error(`O líquido não pode ser maior que o bruto na linha ${indice + 1}.`);
    }

    const valorAnterior = Number(registro.valorAnterior);
    const valorLiquidoAnterior = Number(registro.valorLiquidoAnterior);

    // Sem a base de comparação a RPC não consegue detectar edição concorrente,
    // e aceitar o item mesmo assim reabriria o last-write-wins.
    if (!Number.isFinite(valorAnterior) || !Number.isFinite(valorLiquidoAnterior)) {
      throw new Error(
        `Faltam os valores originais da linha ${indice + 1}. Recarregue a tela.`,
      );
    }

    return {
      id,
      valor: Number(valor.toFixed(2)),
      valorLiquido: Number(valorLiquido.toFixed(2)),
      valorAnterior: Number(valorAnterior.toFixed(2)),
      valorLiquidoAnterior: Number(valorLiquidoAnterior.toFixed(2)),
    };
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
    const itens = lerItens(body?.itens);

    if (!itens.some((item) => String(item.id) === id)) {
      return NextResponse.json(
        { error: "O ajuste precisa incluir a transação aberta." },
        { status: 400 },
      );
    }

    const session = await auth();
    const motivo = String(body?.motivo ?? "").trim().slice(0, 500);

    const { data, error } = await supabaseAdmin.rpc("ajustar_valores_transacao", {
      p_itens: itens,
      p_alterado_por: (session?.user as { id?: string } | undefined)?.id ?? null,
      p_motivo: motivo || null,
    });

    if (error) {
      // A RPC devolve mensagens ja prontas para o usuario nesses dois codigos.
      if (error.code === "22023") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === "P0002") {
        return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
      }
      // 40001: alguém salvou antes; 55000: histórico imutável.
      if (error.code === "40001" || error.code === "55000") {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      /*
       * 55P03 é o `lock_timeout` da RPC: outra sessão está com a linha travada.
       * 40P01 é deadlock — a ordenação do `FOR UPDATE` tornou isso improvável
       * entre duas chamadas desta função, mas outra rota pode segurar a linha.
       *
       * Os dois são "tente de novo", não erro do que foi digitado, e por isso
       * saem como 409 e não como 500. Antes caíam no `throw` e viravam 500 com
       * a mensagem crua do Postgres.
       */
      if (error.code === "55P03" || error.code === "40P01") {
        return NextResponse.json(
          {
            error:
              error.code === "55P03"
                ? error.message
                : "Duas edições ao mesmo tempo se cruzaram. Tente salvar de novo.",
          },
          { status: 409 },
        );
      }
      throw error;
    }

    /*
     * O líquido informado no rateio precisa virar linha de taxa.
     *
     * A RPC grava `valorLiquido` direto, mas desde que o desconto virou linha o
     * gatilho `transacao_valor_coerente_trg` recalcula esse campo como
     * `valor - descontos` em toda escrita. Sem esta etapa, mudar o líquido no
     * rateio não fazia efeito nenhum — o número voltava sozinho e sem aviso.
     *
     * Roda depois da RPC de propósito: é ela que define o bruto de cada linha, e
     * a taxa é a diferença até o líquido pedido. Uma falha aqui não corrompe
     * nada — os brutos já estão certos e o líquido apenas continua o antigo, o
     * que é visível e refazível.
     */
    const avisos: string[] = [];
    for (const item of itens) {
      const resultado = await sincronizarTaxaRecebimento(
        item.id,
        item.valorLiquido,
        (session?.user as { id?: string } | undefined)?.id ?? null,
      );
      if (!resultado.ok) avisos.push(`#${item.id}: ${resultado.erro}`);
    }

    if (avisos.length) {
      return NextResponse.json(
        {
          error: `Os valores brutos foram salvos, mas o líquido não pôde ser ajustado. ${avisos.join(" ")}`,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ data });
  } catch (error: unknown) {
    const erro = error as { statusCode?: number; message?: string };
    const statusAutorizacao = Number(erro?.statusCode);
    const status =
      statusAutorizacao === 401 || statusAutorizacao === 403
        ? statusAutorizacao
        : erro?.message?.includes("linha") || erro?.message?.includes("Informe")
          ? 400
          : 500;

    return NextResponse.json(
      { error: erro?.message ?? "Não foi possível ajustar os valores." },
      { status },
    );
  }
}
