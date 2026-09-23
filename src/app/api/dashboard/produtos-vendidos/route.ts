import { NextResponse } from "next/server";

import { requireDashboardAccess } from "@/app/api/_authz/perms";
import { agregarProdutosVendidos, type ItemVendido } from "@/lib/dashboard/produtos-vendidos";
import { lerPeriodoDaUrl } from "@/lib/dashboard/periodo-consulta";
import { STATUS_VENDAS_REALIZADAS } from "@/lib/meu-perfil/regras";
import { fetchAllSupabaseRows } from "@/lib/supabase-pagination";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Produtos vendidos no período, somando venda de balcão e peça cobrada na OS.
 *
 * EIXOS DE PERÍODO
 * Venda por `pagamento_em`, OS por `execucao_fim_em`. Não `datavenda` nem
 * `dataentrada`, que são quando o orçamento foi digitado — a migration
 * 20260811203000 existe exatamente para separar as duas coisas.
 *
 * FILTRO DE VALIDADE ASSIMÉTRICO, E É DE PROPÓSITO
 * Na venda o filtro de status é obrigatório: `tg_venda_carimbar_marcos`
 * preserva `pagamento_em` no cancelamento, então venda CANCELADA continua com
 * carimbo e só o status a exclui. Na OS é o contrário — `fn_os_execucao_set_times`
 * apaga o carimbo quando a OS é cancelada ou reiniciada, então o carimbo já é a
 * definição de concluída e filtrar status aqui seria divergir do resto do painel
 * (ver src/lib/dashboard/service-order-completion.ts).
 *
 * POR QUE NÃO `estoque_movimento`
 * O razão de estoque parece a fonte unificada ideal e não é: a data dele é a da
 * baixa, que na OS depende de `config_geral.modo_baixa_estoque_os`; ele inclui
 * consumo interno, que não é venda; tem linhas `reconstruido = true` do backfill
 * com data aproximada; e não guarda valor. Ele serve para giro de estoque, não
 * para ranking de vendas.
 *
 * POR QUE AGREGAR EM JS
 * O PostgREST não tem GROUP BY. O recorte é de um período, não da base inteira,
 * e o filtro vai no embed `!inner` — o banco já devolve só os itens do período.
 * Se o ranking começar a encostar em LIMITE_RANKING ou esta rota passar de
 * ~1,5 s, a troca é por uma RPC com UNION ALL + GROUP BY, no molde de
 * `buscar_ultimo_valor_venda_produto`. A resposta HTTP não muda.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LinhaEmbutida = Record<string, any> | Record<string, any>[] | null;

type LinhaVendaProduto = {
  produtoid: number | null;
  quantidade: number | string | null;
  valor_total: number | string | null;
  valor_frete: number | string | null;
  venda: LinhaEmbutida;
  produto: LinhaEmbutida;
};

type LinhaOsProduto = {
  ordemservicoid: number | null;
  produtoid: number | null;
  quantidade: number | string | null;
  subtotal: number | string | null;
  ordem: LinhaEmbutida;
  produto: LinhaEmbutida;
};

/** O PostgREST devolve o embed como objeto ou como array de um, conforme a cardinalidade inferida. */
function primeiro(valor: LinhaEmbutida): Record<string, any> | null {
  const registro = Array.isArray(valor) ? valor[0] : valor;
  return registro && typeof registro === "object" ? registro : null;
}

function numero(valor: unknown) {
  const resultado = Number(valor ?? 0);
  return Number.isFinite(resultado) ? resultado : 0;
}

export async function GET(request: Request) {
  try {
    await requireDashboardAccess();

    const periodo = lerPeriodoDaUrl(new URL(request.url).searchParams);
    if (!periodo) {
      return NextResponse.json({ error: "Período inválido." }, { status: 400 });
    }

    const { inicioIso, fimExclusivoIso } = periodo;

    // O embed de produto é left join de propósito: produto excluído que já
    // vendeu precisa continuar no ranking, senão o gráfico deixa de fechar com
    // o KPI de unidades.
    const [linhasVenda, linhasOs] = await Promise.all([
      fetchAllSupabaseRows<LinhaVendaProduto>(() =>
        supabaseAdmin
          .from("vendaproduto")
          .select(
            "produtoid,quantidade,valor_total,valor_frete," +
              "venda:venda_id!inner(id,status,pagamento_em)," +
              "produto:produtoid(titulo,referencia,unidade,grupo_produto_id,grupo:grupo_produto_id(id,nome))",
          )
          .in("venda.status", STATUS_VENDAS_REALIZADAS)
          .gte("venda.pagamento_em", inicioIso)
          .lt("venda.pagamento_em", fimExclusivoIso)
          .order("id", { ascending: true }),
      ),
      fetchAllSupabaseRows<LinhaOsProduto>(() =>
        supabaseAdmin
          .from("osproduto")
          .select(
            "ordemservicoid,produtoid,quantidade,subtotal," +
              "ordem:ordemservicoid!inner(id,is_deleted,migracao_referencia,execucao_fim_em)," +
              "produto:produtoid(titulo,referencia,unidade,grupo_produto_id,grupo:grupo_produto_id(id,nome))",
          )
          .eq("ordem.is_deleted", false)
          .is("ordem.migracao_referencia", null)
          .gte("ordem.execucao_fim_em", inicioIso)
          .lt("ordem.execucao_fim_em", fimExclusivoIso)
          // `osproduto` não tem id próprio (PK composta). Sem os dois níveis a
          // ordenação não é estável e a paginação pode perder ou repetir linha.
          .order("ordemservicoid", { ascending: true })
          .order("produtoid", { ascending: true }),
      ),
    ]);

    const itens: ItemVendido[] = [];

    for (const linha of linhasVenda) {
      const venda = primeiro(linha.venda);
      const produto = primeiro(linha.produto);

      itens.push({
        origem: "VENDA",
        documentoId: venda?.id,
        produtoId: linha.produtoid,
        titulo: produto?.titulo,
        referencia: produto?.referencia,
        unidade: produto?.unidade,
        grupoId: produto?.grupo_produto_id,
        grupoNome: primeiro(produto?.grupo)?.nome,
        quantidade: linha.quantidade,
        // `valor_total` já vem líquido do desconto do item, mas COM o frete
        // atribuído a ele: o CHECK de `fn_criar_venda_com_itens` é
        // `valor_total = sub_total - desconto + valor_frete`. Sem o abatimento
        // o faturamento infla nas vendas com frete rateado por item.
        faturamento: numero(linha.valor_total) - numero(linha.valor_frete),
      });
    }

    for (const linha of linhasOs) {
      const ordem = primeiro(linha.ordem);
      const produto = primeiro(linha.produto);

      itens.push({
        origem: "OS",
        documentoId: ordem?.id ?? linha.ordemservicoid,
        produtoId: linha.produtoid,
        titulo: produto?.titulo,
        referencia: produto?.referencia,
        unidade: produto?.unidade,
        grupoId: produto?.grupo_produto_id,
        grupoNome: primeiro(produto?.grupo)?.nome,
        quantidade: linha.quantidade,
        // Aqui o subtotal já é o valor líquido do desconto do item (ver
        // src/lib/ordens/desconto.ts) — não repetir a conta do lado da venda.
        faturamento: linha.subtotal,
      });
    }

    const { ranking, totais, truncado } = agregarProdutosVendidos(itens);

    return NextResponse.json(
      {
        periodo: { inicio: periodo.dateFrom, fim: periodo.dateTo },
        totais,
        ranking,
        truncado,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    const status = Number(error?.statusCode);
    return NextResponse.json(
      { error: error?.message ?? "Não foi possível carregar os produtos vendidos." },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}
