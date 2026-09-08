// src/app/api/me/vendas/indicadores/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { lerComissaoVenda } from "@/lib/vendas/comissao";
import {
  erroInterno,
  getMeUserId,
  isNextResponse,
  num,
  parsePeriodo,
  STATUS_VENDAS_REALIZADAS,
} from "../../_helpers";

/**
 * Totais da aba "Vendas".
 *
 * Vive fora de /api/me/vendas pelo mesmo motivo do irmão em
 * /api/me/ordens/indicadores: os números cobrem o período inteiro, não a
 * página, então não faz sentido recalculá-los a cada troca de página.
 *
 * O que a aba precisa mostrar é a **composição** do total, não só o total: a
 * soma dos produtos vendidos não bate com o valor das vendas quando há frete
 * ou desconto no meio, e quem vende precisa enxergar as parcelas separadas
 * para saber sobre o que a comissão incide.
 *
 * As parcelas fecham por construção — `produtos − descontos + frete = total` —
 * porque o desconto é recuperado dos próprios totais gravados, e não somado de
 * uma coluna à parte: a venda grava tipo + valor (R$ ou %), nunca o resultado.
 * É o mesmo caminho de `inferirDescontoGeralOs`, usado nos relatórios.
 */
const TETO_VENDAS = 1000;

export async function GET(req: Request) {
  const userId = await getMeUserId(req);
  if (isNextResponse(userId)) return userId;

  try {
    const { searchParams } = new URL(req.url);
    const periodo = parsePeriodo(searchParams);

    // Mesmo recorte da lista, e é o que faz os cards baterem com a tabela:
    // venda atribuída ao usuário (`vendedor`), já realizada, com o eixo de
    // período em `pagamento_em`.
    let query = supabaseAdmin
      .from("venda")
      .select("id, sub_total, valor_frete, valortotal, comissao:venda_comissao(base,percentual,valor_comissao)", { count: "exact" })
      .eq("vendedor", userId)
      .in("status", STATUS_VENDAS_REALIZADAS)
      .not("pagamento_em", "is", null);

    if (periodo.inicio) query = query.gte("pagamento_em", periodo.inicio);
    if (periodo.fimExclusivo) query = query.lt("pagamento_em", periodo.fimExclusivo);

    const { data, error, count } = await query.range(0, TETO_VENDAS - 1);
    if (error) throw error;

    const linhas = data ?? [];
    const totalVendas = count ?? linhas.length;

    let produtos = 0;
    let frete = 0;
    let descontos = 0;
    let total = 0;
    let comissao = 0;

    for (const registro of linhas) {
      const venda = registro as Record<string, unknown>;
      comissao += lerComissaoVenda(venda.comissao)?.valor_comissao ?? 0;
      const valorTotal = num(venda.valortotal);
      const valorFrete = num(venda.valor_frete);
      // Venda antiga pode não ter `sub_total` gravado; sem o resgate pelo total
      // o card de produtos apareceria zerado ao lado de um total cheio.
      const subtotalGravado = num(venda.sub_total);
      const subtotal = subtotalGravado > 0 ? subtotalGravado : Math.max(0, valorTotal - valorFrete);

      produtos += subtotal;
      frete += valorFrete;
      total += valorTotal;
      // Piso em zero: arredondamento de migração pode deixar o total um centavo
      // acima da soma, e um "desconto negativo" no card é pior que nada.
      descontos += Math.max(0, subtotal + valorFrete - valorTotal);
    }

    return NextResponse.json(
      {
        vendas: totalVendas,
        produtos,
        frete,
        descontos,
        total,
        comissao: Math.round(comissao * 100) / 100,
        parcial: totalVendas > linhas.length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return erroInterno("GET /api/me/vendas/indicadores", e);
  }
}
