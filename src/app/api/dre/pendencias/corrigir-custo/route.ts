export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireFinanceiroEdit, requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Correção do custo de um item vendido sem custo, a partir da fila da DRE.
 *
 * POR QUE UMA ROTA NOVA, E NÃO A DE EVENTO DA OS
 * `/api/eventos-financeiros/[id]` e a irmã `sincronizar-ultimo-custo` resolvem o
 * evento por `ordemDoEvento`: sem OS, respondem 404. Só que a maioria destes
 * itens é de VENDA — no Demir, 28 dos 34, e os 6 de setembro inteiros. Uma
 * correção oferecida na DRE que falha justamente no caso mais comum seria pior
 * que não oferecer.
 *
 * O QUE ESTA ROTA NÃO FAZ
 * Não toca no cadastro do produto. Quem quiser propagar o custo chama
 * `PATCH /api/products/[id]`, que tem a permissão de estoque e as validações
 * dela. Repetir aqui o `UPDATE produto` seria criar uma segunda porta para a
 * mesma regra, com o risco de as duas divergirem — e a de estoque é a que a
 * valorização de estoque respeita.
 *
 * Por isso a ordem, na tela, é livro primeiro e cadastro depois: se o segundo
 * passo esbarrar em permissão, a DRE já está corrigida e a mensagem diz o que
 * faltou.
 */

const SELECT_EVENTO =
  "id, origem, natureza, natureza_dre, status, valor, descricao, produtoid, " +
  "quantidade_snapshot, dados_snapshot, competencia_em";

type EventoDeCusto = {
  id: number;
  valor: number | null;
  descricao: string | null;
  produtoid: number | null;
  quantidade_snapshot: number | string | null;
  dados_snapshot: Record<string, unknown> | null;
  competencia_em: string | null;
  natureza_dre: string | null;
  status: string;
};

function erro(mensagem: string, status: number) {
  return NextResponse.json({ error: mensagem }, { status });
}

/** Quantidade do snapshot. Sem ela o custo unitário não vira valor do evento. */
function quantidadeDoEvento(evento: EventoDeCusto) {
  const bruta = Number(evento.quantidade_snapshot ?? 0);
  return Number.isFinite(bruta) && bruta > 0 ? bruta : 1;
}

async function carregarEvento(eventoId: number) {
  const { data, error } = await supabaseAdmin
    .from("eventos_financeiros")
    .select(SELECT_EVENTO)
    .eq("id", eventoId)
    .maybeSingle();
  if (error) throw error;
  return data as EventoDeCusto | null;
}

/**
 * A pendência precisa continuar existindo no momento da gravação. Sem esta
 * checagem, um duplo clique — ou duas abas — sobrescreveria um custo já
 * corrigido com o valor da tela velha.
 */
function pendenciaAindaVale(evento: EventoDeCusto | null) {
  if (!evento) return "Lançamento não encontrado.";
  if (!["ATIVO", "CONVERTIDO"].includes(evento.status)) {
    return "Este lançamento não está ativo.";
  }
  if (evento.natureza_dre !== "CUSTO") {
    return "Este lançamento não é um custo.";
  }
  if ((evento.dados_snapshot as any)?.custo_nao_informado !== true) {
    return "Este item já teve o custo informado.";
  }
  return null;
}

/** GET /api/dre/pendencias/corrigir-custo?evento=123 — o que o diálogo precisa mostrar. */
export async function GET(req: Request) {
  try {
    await requireFinanceirosAccess();

    const eventoId = Number(new URL(req.url).searchParams.get("evento"));
    if (!Number.isInteger(eventoId) || eventoId <= 0) {
      return erro("Informe o lançamento.", 400);
    }

    const evento = await carregarEvento(eventoId);
    const impedimento = pendenciaAindaVale(evento);
    if (impedimento) return erro(impedimento, evento ? 409 : 404);

    const quantidade = quantidadeDoEvento(evento!);

    let produto: {
      id: number;
      nome: string;
      ultimaCompra: number;
      precoMedio: number;
      custoSugerido: number | null;
      origemSugerida: "ULTIMA_COMPRA" | "PRECO_MEDIO" | null;
    } | null = null;

    if (evento!.produtoid) {
      const { data, error } = await supabaseAdmin
        .from("produto")
        .select("id, titulo, descricao, ultimovalordecompra, precocompra")
        .eq("id", evento!.produtoid)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        // Mesma ordem da geração do evento: última entrada e, na falta dela, o
        // preço médio. Divergir daqui faria a sugestão da tela apontar um custo
        // diferente do que a sincronização gravaria.
        const ultimaCompra = Number(data.ultimovalordecompra ?? 0);
        const precoMedio = Number(data.precocompra ?? 0);
        const usaUltima = Number.isFinite(ultimaCompra) && ultimaCompra > 0;
        const sugerido = usaUltima ? ultimaCompra : precoMedio;
        produto = {
          id: Number(data.id),
          nome: String(data.titulo || data.descricao || `Produto #${data.id}`),
          ultimaCompra,
          precoMedio,
          custoSugerido: Number.isFinite(sugerido) && sugerido > 0 ? sugerido : null,
          origemSugerida: !Number.isFinite(sugerido) || sugerido <= 0
            ? null
            : usaUltima
              ? "ULTIMA_COMPRA"
              : "PRECO_MEDIO",
        };
      }
    }

    return NextResponse.json(
      {
        eventoId,
        descricao: evento!.descricao,
        competencia: evento!.competencia_em,
        quantidade,
        valorAtual: Number(evento!.valor ?? 0),
        produto,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Erro ao carregar o item sem custo.";
    const status = /forbidden|permiss|autentic/i.test(mensagem) ? 403 : 500;
    console.error("[GET /api/dre/pendencias/corrigir-custo]", e);
    return erro(mensagem, status);
  }
}

/**
 * POST — grava o custo no lançamento.
 *
 * Corpo: `{ eventoId, custoUnitario }` ou `{ eventoId, usarCustoDoCadastro: true }`.
 */
export async function POST(req: Request) {
  try {
    await requireFinanceiroEdit();

    const corpo = await req.json().catch(() => ({}));
    const eventoId = Number(corpo?.eventoId);
    if (!Number.isInteger(eventoId) || eventoId <= 0) {
      return erro("Informe o lançamento.", 400);
    }

    const evento = await carregarEvento(eventoId);
    const impedimento = pendenciaAindaVale(evento);
    if (impedimento) return erro(impedimento, evento ? 409 : 404);

    const usarCadastro = corpo?.usarCustoDoCadastro === true;
    let custoUnitario = Number(corpo?.custoUnitario);
    let origem = "INFORMADO_MANUALMENTE";

    if (usarCadastro) {
      if (!evento!.produtoid) {
        return erro("Este lançamento não está vinculado a um produto do cadastro.", 409);
      }
      const { data, error } = await supabaseAdmin
        .from("produto")
        .select("ultimovalordecompra, precocompra")
        .eq("id", evento!.produtoid)
        .maybeSingle();
      if (error) throw error;
      const ultimaCompra = Number(data?.ultimovalordecompra ?? 0);
      const precoMedio = Number(data?.precocompra ?? 0);
      const usaUltima = Number.isFinite(ultimaCompra) && ultimaCompra > 0;
      custoUnitario = usaUltima ? ultimaCompra : precoMedio;
      origem = usaUltima ? "ULTIMA_COMPRA" : "PRECO_MEDIO";
      if (!Number.isFinite(custoUnitario) || custoUnitario <= 0) {
        return erro(
          "O produto continua sem último valor de entrada nem preço médio de compra.",
          409,
        );
      }
    }

    if (!Number.isFinite(custoUnitario) || custoUnitario <= 0) {
      return erro("Informe um custo maior que zero.", 400);
    }

    const quantidade = quantidadeDoEvento(evento!);
    const valor = Math.round(custoUnitario * quantidade * 100) / 100;
    const corrigidoEm = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("eventos_financeiros")
      .update({
        valor,
        valor_unitario_snapshot: custoUnitario,
        quantidade_snapshot: quantidade,
        updated_at: corrigidoEm,
        dados_snapshot: {
          ...(evento!.dados_snapshot ?? {}),
          custo_nao_informado: false,
          // Custo digitado é informação, não estimativa. A distinção sobrevive
          // no snapshot porque quem auditar a margem depois precisa saber se o
          // número veio do cadastro ou da mão de alguém.
          custo_estimado: usarCadastro,
          custo_origem: origem,
          custo_corrigido_em: corrigidoEm,
        },
      })
      // Só grava se a pendência ainda estiver de pé no banco: entre a leitura e
      // aqui, outra aba pode ter corrigido o mesmo item.
      .eq("id", eventoId)
      .contains("dados_snapshot", { custo_nao_informado: true })
      .select("id, valor, dados_snapshot")
      .maybeSingle();
    if (error) throw error;
    if (!data) return erro("Este item já teve o custo informado.", 409);

    return NextResponse.json({
      evento: data,
      custoUnitario,
      quantidade,
      valor,
      produtoId: evento!.produtoid,
    });
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Erro ao corrigir o custo.";
    const status = /forbidden|permiss|autentic/i.test(mensagem) ? 403 : 500;
    console.error("[POST /api/dre/pendencias/corrigir-custo]", e);
    return erro(mensagem, status);
  }
}
