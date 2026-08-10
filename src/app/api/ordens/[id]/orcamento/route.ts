// src/app/api/ordens/[id]/orcamento/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { buscarModoBaixaEstoqueOS } from "@/lib/ordens/estoque-os";
import { sanitizeFinancialSurchargeType } from "@/lib/financial-surcharge";
import {
  arredondarMoeda,
  calcularTotalComDesconto,
  sanitizeTipoDesconto,
  type TipoDesconto,
} from "@/lib/ordens/desconto";
import { calcularTotaisOs, sanitizarValorFrete } from "@/lib/ordens/totais";
import { valorDeFace } from "@/lib/financeiro/transacao";
import { mesesDeCompetenciaFechada } from "../eventos-financeiros/_lib/competencia";

type Num = number;
const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function limitarDesconto(base: number, tipo: TipoDesconto, desconto: number) {
  const valor = Math.max(0, toNum(desconto));
  if (tipo === "PORCENTAGEM") return Math.min(valor, 100);
  if (tipo === "FIXO") return Math.min(valor, Math.max(0, toNum(base)));
  return 0;
}

/* =========================================================
 * GET — itens do orçamento (produtos + serviços)
 * ========================================================= */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const osId = Number(id);
    if (!osId || Number.isNaN(osId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    // Produtos com descrição
    const { data: osRow, error: osErr } = await supabase
      .from("ordemservico")
      .select("subtotal, desconto_tipo, desconto, valor_frete, acrescimo_financeiro_tipo, acrescimo_financeiro_valor")
      .eq("id", osId)
      .maybeSingle();

    if (osErr) throw osErr;

    const { data: prodRows, error: prodErr } = await supabase
      .from("osproduto")
      .select(`
        ordemservicoid,
        produtoid,
        quantidade,
        precounitario,
        subtotal,
        desconto_tipo,
        desconto,
        produto:produtoid (descricao, titulo)
      `)
      .eq("ordemservicoid", osId);

    if (prodErr) throw prodErr;

    const produtos = (prodRows ?? []).map((r: any) => ({
      produtoid: toNum(r.produtoid),
      descricao: String(r.produto?.titulo || r.produto?.descricao || ""),
      quantidade: toNum(r.quantidade ?? 1),
      precounitario: toNum(r.precounitario ?? 0),
      subtotal: toNum(r.subtotal ?? 0),
      descontoTipo: r.desconto_tipo ?? null,
      desconto: toNum(r.desconto ?? 0),
    }));

    const { data: avulsoRows, error: avulsoErr } = await supabase
      .from("osproduto_avulso")
      .select("id, titulo, quantidade, precounitario, subtotal, desconto_tipo, desconto")
      .eq("ordemservicoid", osId)
      .order("id", { ascending: true });

    if (avulsoErr) throw avulsoErr;
    const produtosAvulsos = (avulsoRows ?? []).map((r: any) => ({
      id: toNum(r.id),
      titulo: String(r.titulo ?? ""),
      quantidade: toNum(r.quantidade ?? 1),
      precounitario: toNum(r.precounitario ?? 0),
      subtotal: toNum(r.subtotal ?? 0),
      descontoTipo: r.desconto_tipo ?? null,
      desconto: toNum(r.desconto ?? 0),
    }));

    // Serviços com descrição
    const { data: servRows, error: servErr } = await supabase
      .from("osservico")
      .select(`
        ordemservicoid,
        servicoid,
        descricao,
        quantidade,
        precounitario,
        subtotal,
        desconto_tipo,
        desconto,
        servico:servicoid (descricao)
      `)
      .eq("ordemservicoid", osId);

    if (servErr) throw servErr;

    const servicos = (servRows ?? []).map((r: any) => ({
      servicoid: toNum(r.servicoid),
      descricao: String(r.servico?.descricao ?? ""),
      descricaoServico: r.descricao ? String(r.descricao) : null,
      quantidade: toNum(r.quantidade ?? 1),
      precounitario: toNum(r.precounitario ?? 0),
      subtotal: toNum(r.subtotal ?? 0),
      descontoTipo: r.desconto_tipo ?? null,
      desconto: toNum(r.desconto ?? 0),
    }));

    return NextResponse.json(
      {
        produtos,
        produtosAvulsos,
        servicos,
        subtotal: toNum((osRow as any)?.subtotal ?? 0),
        descontoTipo: (osRow as any)?.desconto_tipo ?? null,
        desconto: toNum((osRow as any)?.desconto ?? 0),
        valorFrete: toNum((osRow as any)?.valor_frete ?? 0),
        acrescimoFinanceiroTipo: (osRow as any)?.acrescimo_financeiro_tipo ?? null,
        acrescimoFinanceiroValor: toNum((osRow as any)?.acrescimo_financeiro_valor ?? 0),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("GET /api/ordens/[id]/orcamento", err);
    return NextResponse.json(
      { error: "Falha ao carregar orçamento" },
      { status: 500 }
    );
  }
}

/* =========================================================
 * PUT — salva orçamento com sincronismo de estoque
 *
 * - Calcula diffs entre o que está salvo e o que chegou
 * - Valida estoque disponível antes de aplicar
 * - Ajusta estoque do produto e tabela osproduto_baixa
 * - Atualiza osproduto/osservico e orcamentototal
 * - Nunca permite ultrapassar estoque (responde 409 com itens faltantes)
 * ========================================================= */
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const osId = Number(id);
    if (!osId || Number.isNaN(osId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const { data: osAtual, error: osAtualError } = await supabase
      .from("ordemservico")
      .select("id, status")
      .eq("id", osId)
      .maybeSingle();
    if (osAtualError) throw osAtualError;
    if (!osAtual) return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
    const statusAtual = String(osAtual.status || "");
    if (["CONCLUIDO", "SEM_COBRANCA", "CANCELADO"].includes(statusAtual)) {
      return NextResponse.json({ error: "O orçamento não pode ser alterado após a finalização da OS." }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const produtosBody: Array<{
      produtoid: Num;
      quantidade: Num;
      precounitario: Num;
      subtotal?: Num;
      descontoTipo?: string | null;
      desconto?: Num;
    }> = Array.isArray(body?.produtos) ? body.produtos : [];

    const servicosBody: Array<{
      servicoid: Num;
      descricao?: string | null;
      quantidade: Num;
      precounitario: Num;
      subtotal?: Num;
      descontoTipo?: string | null;
      desconto?: Num;
    }> = Array.isArray(body?.servicos) ? body.servicos : [];
    const avulsosBody: Array<{
      id?: Num;
      titulo: string;
      quantidade: Num;
      precounitario: Num;
      descontoTipo?: string | null;
      desconto?: Num;
    }> = Array.isArray(body?.produtosAvulsos) ? body.produtosAvulsos : [];
    const descontoTipo = sanitizeTipoDesconto(body?.descontoTipo);
    const descontoSolicitado = Math.max(0, toNum(body?.desconto ?? 0));
    const valorFrete = sanitizarValorFrete(body?.valorFrete);
    const acrescimoFinanceiroTipo = sanitizeFinancialSurchargeType(body?.acrescimoFinanceiroTipo);
    const acrescimoFinanceiroValor = Math.max(0, toNum(body?.acrescimoFinanceiroValor ?? 0));
    if (body?.acrescimoFinanceiroTipo != null && !acrescimoFinanceiroTipo) {
      return NextResponse.json({ error: "Tipo de acréscimo financeiro inválido." }, { status: 400 });
    }
    if (acrescimoFinanceiroTipo === "PORCENTAGEM" && acrescimoFinanceiroValor > 100) {
      return NextResponse.json({ error: "O acréscimo percentual deve estar entre 0 e 100." }, { status: 400 });
    }

    const modoBaixaEstoqueOS = await buscarModoBaixaEstoqueOS();

    const avulsosNormalizados = avulsosBody.map((item) => {
      const titulo = String(item.titulo ?? "").trim();
      const quantidade = Math.max(0, Math.trunc(toNum(item.quantidade)));
      const precounitario = Math.max(0, toNum(item.precounitario));
      const itemDescontoTipo = sanitizeTipoDesconto(item.descontoTipo);
      const itemDesconto = limitarDesconto(
        quantidade * precounitario,
        itemDescontoTipo,
        toNum(item.desconto ?? 0),
      );
      return {
        id: item.id ? toNum(item.id) : null,
        titulo,
        quantidade,
        precounitario,
        desconto_tipo: itemDescontoTipo,
        desconto: itemDesconto,
        subtotal: calcularTotalComDesconto(quantidade * precounitario, itemDescontoTipo, itemDesconto),
      };
    });

    if (avulsosNormalizados.some((item) => !item.titulo || item.quantidade < 1 || item.precounitario <= 0)) {
      return NextResponse.json(
        { error: "Informe título, quantidade e valor maior que zero para cada produto avulso." },
        { status: 400 },
      );
    }

    if (avulsosNormalizados.some((item) => !item.id)) {
      const { data: configAvulso, error: configAvulsoError } = await supabase
        .from("config_geral")
        .select("permitir_produto_avulso_os")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (configAvulsoError) throw configAvulsoError;
      if (configAvulso?.permitir_produto_avulso_os !== true) {
        return NextResponse.json({ error: "Produtos avulsos em OS não estão habilitados." }, { status: 403 });
      }
    }

    // Normaliza (não aceitaremos números negativos)
    const desejados = produtosBody
      .map((p) => {
        const quantidade = Math.max(0, toNum(p.quantidade));
        const precounitario = Math.max(0, toNum(p.precounitario));
        const descontoTipo = sanitizeTipoDesconto(p.descontoTipo);
        return {
          produtoid: toNum(p.produtoid),
          quantidade,
          precounitario,
          descontoTipo,
          desconto: limitarDesconto(
            quantidade * precounitario,
            descontoTipo,
            toNum(p.desconto ?? 0),
          ),
        };
      })
      .map((p) => ({
        ...p,
        subtotal: calcularTotalComDesconto(p.quantidade * p.precounitario, p.descontoTipo, p.desconto),
      }))
      // se veio quantidade 0, tratamos como remoção (não insere)
      .filter((p) => p.quantidade > 0);

    // Leitura atual de itens, baixas e estoques
    const [{ data: atuaisRows, error: atuaisErr }, { data: baixaRows, error: baixaErr }] =
      await Promise.all([
        supabase
          .from("osproduto")
          .select("produtoid, quantidade")
          .eq("ordemservicoid", osId),
        supabase
          .from("osproduto_baixa")
          .select("produtoid, quantidade")
          .eq("ordemservicoid", osId),
      ]);

    if (atuaisErr) throw atuaisErr;
    if (baixaErr) throw baixaErr;

    const atuaisMap = new Map<number, number>(); // produtoid -> quantidade salva
    (atuaisRows || []).forEach((r: any) => {
      atuaisMap.set(toNum(r.produtoid), toNum(r.quantidade));
    });

    const baixaMap = new Map<number, number>(); // produtoid -> quantidade já baixada p/ esta OS
    (baixaRows || []).forEach((r: any) => {
      baixaMap.set(toNum(r.produtoid), toNum(r.quantidade));
    });

    const desejadosMap = new Map<
      number,
      { quantidade: number; precounitario: number; subtotal: number; descontoTipo: TipoDesconto; desconto: number }
    >();
    desejados.forEach((d) => {
      desejadosMap.set(d.produtoid, {
        quantidade: d.quantidade,
        precounitario: d.precounitario,
        subtotal: d.subtotal!,
        descontoTipo: d.descontoTipo,
        desconto: d.desconto,
      });
    });

    // Conjunto de todos os produtos envolvidos
    const allProdIds = Array.from(
      new Set<number>([
        ...Array.from(atuaisMap.keys()),
        ...Array.from(desejadosMap.keys()),
      ])
    );

    // Quando o estoque acompanha o orçamento.
    //
    // No modo ORÇAMENTO, sempre: reservar é o próprio sentido do modo.
    //
    // No modo EXECUÇÃO, só depois que a OS entrou em execução. Antes disso
    // editar o orçamento não pode mexer em saldo — a baixa acontece ao iniciar a
    // OS. Depois disso tem que mexer, senão retirar um produto deixa o saldo
    // preso e acrescentar um deixa a OS levando material que nunca foi baixado.
    //
    // O status é o sinal principal; a baixa registrada entra como reforço para
    // OS que consumiu por outro caminho. Só a baixa não bastaria: uma OS em
    // andamento que ficasse momentaneamente sem produtos voltaria a ser tratada
    // como se ainda não tivesse consumido.
    const osEmExecucao = ["EM_ANDAMENTO", "PAGAMENTO"].includes(statusAtual);
    const sincronizarEstoque =
      modoBaixaEstoqueOS === "ORCAMENTO" || osEmExecucao || baixaMap.size > 0;

    // Busca estoques/títulos dos produtos envolvidos
    const { data: prodInfos, error: prodInfoErr } = allProdIds.length
      ? sincronizarEstoque
        ? await supabase
            .from("produto")
            .select("id, estoque, titulo")
            .in("id", allProdIds)
        : { data: [], error: null }
      : { data: [], error: null };

    if (prodInfoErr) throw prodInfoErr;

    const estoqueMap = new Map<number, number>(); // produtoid -> estoque atual
    const tituloMap = new Map<number, string>(); // produtoid -> titulo
    (prodInfos || []).forEach((p: any) => {
      estoqueMap.set(toNum(p.id), toNum(p.estoque));
      tituloMap.set(toNum(p.id), String(p.titulo ?? "Produto"));
    });

    // Validação de disponibilidade (não permite ultrapassar estoque)
    // Regra: baixa final desejada deve ser atendida pelo estoque disponível atual + estorno do que já estava reservado para a própria OS
    // disponibilidade = estoqueAtual + (quantidade já baixada para esta OS) - (quantidade a reservar nova)
    // Mas como a baixa final == quantidade desejada, a reserva nova é (desejada - baixadaAtual). Se negativa, é estorno (ok).
    const faltantes: Array<{ id: number; titulo: string; disponivel: number; solicitado: number }> = [];

    if (sincronizarEstoque) {
      allProdIds.forEach((pid) => {
      const desejada = desejadosMap.get(pid)?.quantidade ?? 0;
      const baixadaAtual = baixaMap.get(pid) ?? 0;
      const deltaReserva = desejada - baixadaAtual; // o que precisa aumentar (se > 0)
      if (deltaReserva > 0) {
        const estoqueAtual = estoqueMap.get(pid) ?? 0;
        const disponivel = estoqueAtual; // já consideramos que o que estava baixado pertence à OS
        if (deltaReserva > disponivel) {
          faltantes.push({
            id: pid,
            titulo: tituloMap.get(pid) ?? `Produto #${pid}`,
            disponivel,
            solicitado: deltaReserva,
          });
        }
      }
      });
    }

    if (faltantes.length) {
      return NextResponse.json(
        {
          error: "Estoque insuficiente para um ou mais itens",
          itens: faltantes,
        },
        { status: 409 }
      );
    }

    // --- Aplicação das alterações ---
    // 1) Atualiza tabela osproduto para refletir "desejados"
    //    - remove os que não estão mais presentes
    //    - upsert para os presentes
    const idsParaManter = new Set(desejados.map((d) => d.produtoid));

    // Remover os ausentes (também estornaremos baixa e estoque no passo 2)
    const idsParaRemover = Array.from(atuaisMap.keys()).filter(
      (pid) => !idsParaManter.has(pid)
    );
    if (idsParaRemover.length) {
      const del = await supabase
        .from("osproduto")
        .delete()
        .eq("ordemservicoid", osId)
        .in("produtoid", idsParaRemover);
      if (del.error) throw del.error;
    }

    // Upsert dos desejados (inserir/atualizar linha com preço/subtotal)
    if (desejados.length) {
      const payload = desejados.map((d) => ({
        ordemservicoid: osId,
        produtoid: d.produtoid,
        quantidade: d.quantidade,
        precounitario: d.precounitario,
        subtotal: d.subtotal,
        desconto_tipo: d.descontoTipo,
        desconto: d.desconto,
      }));
      const up = await supabase.from("osproduto").upsert(payload, {
        onConflict: "ordemservicoid,produtoid",
        ignoreDuplicates: false,
      });
      if (up.error) throw up.error;
    }

    // 2) Ajusta osproduto_baixa e produto.estoque conforme deltas
    //
    // O ajuste roda no banco (sincronizar_baixa_estoque_os_produto): a RPC trava
    // a linha do produto, calcula o delta contra a baixa vigente e carimba o
    // movimento no razao de estoque. Antes isso era feito aqui lendo o saldo e
    // regravando o valor absoluto, o que perdia atualizacao quando duas edicoes
    // do mesmo produto aconteciam ao mesmo tempo.
    if (sincronizarEstoque) {
      for (const pid of allProdIds) {
        const desejada = desejadosMap.get(pid)?.quantidade ?? 0;

        const sync = await supabase.rpc("sincronizar_baixa_estoque_os_produto", {
          p_os_id: osId,
          p_produto_id: pid,
          p_quantidade_alvo: desejada,
        });

        if (sync.error) {
          const mensagem = sync.error.message ?? "";
          if (/insuficiente/i.test(mensagem)) {
            return NextResponse.json(
              {
                error: "Estoque insuficiente para um ou mais itens",
                itens: [
                  {
                    id: pid,
                    titulo: tituloMap.get(pid) ?? `Produto #${pid}`,
                    disponivel: estoqueMap.get(pid) ?? 0,
                    solicitado: desejada - (baixaMap.get(pid) ?? 0),
                  },
                ],
              },
              { status: 409 }
            );
          }
          throw sync.error;
        }

        baixaMap.set(pid, desejada);
      }
    }

    // 3) Serviços: estratégia simples — limpar e inserir (não afetam estoque)
    {
      const { data: atuaisServicosRows, error: atuaisServicosErr } = await supabase
        .from("osservico")
        .select("servicoid")
        .eq("ordemservicoid", osId);

      if (atuaisServicosErr) throw atuaisServicosErr;

      const servicosNormalizados = servicosBody
        .map((s) => {
          const quantidade = Math.max(0, toNum(s.quantidade) || 1);
          const precounitario = toNum(s.precounitario ?? 0);
          const itemDescontoTipo = sanitizeTipoDesconto(s.descontoTipo);
          const itemDesconto = limitarDesconto(
            quantidade * precounitario,
            itemDescontoTipo,
            toNum(s.desconto ?? 0),
          );

          return {
            ordemservicoid: osId,
            servicoid: toNum(s.servicoid),
            descricao: s.descricao ? String(s.descricao).trim() : null,
            quantidade,
            precounitario,
            desconto_tipo: itemDescontoTipo,
            desconto: itemDesconto,
            subtotal: calcularTotalComDesconto(quantidade * precounitario, itemDescontoTipo, itemDesconto),
          };
        })
        .filter((s) => s.servicoid > 0 && s.quantidade > 0);

      const idsServicosParaManter = new Set(servicosNormalizados.map((s) => s.servicoid));
      const idsServicosParaRemover = (atuaisServicosRows ?? [])
        .map((s: any) => toNum(s.servicoid))
        .filter((servicoid) => !idsServicosParaManter.has(servicoid));

      if (idsServicosParaRemover.length) {
        const delS = await supabase
          .from("osservico")
          .delete()
          .eq("ordemservicoid", osId)
          .in("servicoid", idsServicosParaRemover);
        if (delS.error) throw delS.error;
      }

      if (servicosNormalizados.length) {
        const upS = await supabase.from("osservico").upsert(servicosNormalizados, {
          onConflict: "ordemservicoid,servicoid",
          ignoreDuplicates: false,
        });
        if (upS.error) throw upS.error;
      }
    }

    // 4) Sincroniza produtos avulsos (ainda não movimentam estoque).
    const { data: avulsosAtuais, error: avulsosAtuaisError } = await supabase
      .from("osproduto_avulso")
      .select("id")
      .eq("ordemservicoid", osId);
    if (avulsosAtuaisError) throw avulsosAtuaisError;

    const idsAvulsosManter = new Set(avulsosNormalizados.map((item) => item.id).filter(Boolean));
    const idsAvulsosRemover = (avulsosAtuais ?? [])
      .map((item: any) => toNum(item.id))
      .filter((id) => !idsAvulsosManter.has(id));
    if (idsAvulsosRemover.length > 0) {
      const removidos = await supabase
        .from("osproduto_avulso")
        .delete()
        .eq("ordemservicoid", osId)
        .in("id", idsAvulsosRemover);
      if (removidos.error) throw removidos.error;
    }

    for (const item of avulsosNormalizados) {
      const payload = {
        titulo: item.titulo,
        quantidade: item.quantidade,
        precounitario: item.precounitario,
        desconto_tipo: item.desconto_tipo,
        desconto: item.desconto,
        subtotal: item.subtotal,
        updated_at: new Date().toISOString(),
      };
      const result = item.id
        ? await supabase.from("osproduto_avulso").update(payload).eq("id", item.id).eq("ordemservicoid", osId)
        : await supabase.from("osproduto_avulso").insert({ ...payload, ordemservicoid: osId });
      if (result.error) throw result.error;
    }

    // 5) Atualiza total geral da OS
    const totalProdutos = desejados.reduce<number>(
      (acc, p) => acc + (Number(p.subtotal) || 0),
      0
    );
    const totalServicos = servicosBody.reduce<number>((acc, s) => {
      const quantidade = Math.max(0, toNum(s.quantidade) || 1);
      const bruto = quantidade * toNum(s.precounitario ?? 0);
      return acc + calcularTotalComDesconto(
        bruto,
        sanitizeTipoDesconto(s.descontoTipo),
        limitarDesconto(
          bruto,
          sanitizeTipoDesconto(s.descontoTipo),
          toNum(s.desconto ?? 0),
        )
      );
    }, 0);
    const totalProdutosAvulsos = avulsosNormalizados.reduce(
      (acc, item) => acc + item.subtotal,
      0,
    );
    const subtotal = arredondarMoeda(totalProdutos + totalProdutosAvulsos + totalServicos);
    const desconto = limitarDesconto(subtotal, descontoTipo, descontoSolicitado);
    const totais = calcularTotaisOs({
      subtotal,
      descontoTipo,
      desconto,
      valorFrete,
      acrescimoFinanceiroTipo,
      acrescimoFinanceiroValor,
    });
    const totalGeral = totais.totalComercial;

    const { data: transacoes, error: transacoesErr } = await supabase
      .from("transacao")
      .select("valor, valor_acrescimos")
      .eq("ordemservicoid", osId)
      .eq("tipo", "RECEITA")
      .is("evento_financeiro_id", null)
      .eq("is_deleted", false);

    if (transacoesErr) throw transacoesErr;

    const totalComprometido = (transacoes ?? []).reduce(
      (acc: number, row: any) => acc + valorDeFace(row),
      0,
    );
    // Mantém o identificador usado na mensagem legada; agora ele inclui também
    // títulos pendentes, pois ambos comprometem o total da OS.
    const totalFinanceiro = totais.totalFinanceiro;
    if (totalFinanceiro < totalComprometido) {
      return NextResponse.json(
        {
          error: `O total financeiro da OS não pode ficar menor que os pagamentos e títulos já registrados (${totalComprometido.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).`,
        },
        { status: 409 }
      );
    }

    const updOS = await supabase
      .from("ordemservico")
      .update({
        subtotal,
        desconto_tipo: descontoTipo,
        desconto,
        valor_frete: totais.valorFrete,
        orcamentototal: totalGeral,
        acrescimo_financeiro_tipo: acrescimoFinanceiroTipo,
        acrescimo_financeiro_valor: acrescimoFinanceiroTipo ? acrescimoFinanceiroValor : 0,
      })
      .eq("id", osId);
    if (updOS.error) throw updOS.error;

    let aviso: string | null = null;

    if (["ORCAMENTO_APROVADO", "EM_ANDAMENTO", "PAGAMENTO"].includes(statusAtual)) {
      // A reconciliacao reescreve o valor de todo evento nao convertido, sem
      // olhar competencia. Se algum deles ja pertence a um mes fechado, a DRE
      // daquele periodo muda junto — o usuario precisa saber qual.
      const { data: competencias, error: competenciasError } = await supabase
        .from("eventos_financeiros")
        .select("competencia_em")
        .eq("ordemservicoid", osId)
        .neq("status", "CANCELADO")
        .not("competencia_em", "is", null);
      if (competenciasError) throw competenciasError;

      const mesesAfetados = mesesDeCompetenciaFechada(
        (competencias ?? []).map((row: any) => row.competencia_em),
      );

      const { error: reconciliacaoError } = await supabase.rpc("reconciliar_eventos_financeiros_os", {
        p_ordemservicoid: osId,
        p_incluir_comissoes: ["EM_ANDAMENTO", "PAGAMENTO"].includes(statusAtual),
      });
      if (reconciliacaoError) throw reconciliacaoError;

      if (mesesAfetados.length) {
        aviso =
          `Esta OS tem lançamentos com competência em ${mesesAfetados.join(", ")}. ` +
          `A DRE desse período foi recalculada com os novos valores.`;
      }
    }

    return NextResponse.json({
      ok: true,
      totalGeral,
      valorFrete: totais.valorFrete,
      totalFinanceiro,
      aviso,
    });
  } catch (err: any) {
    console.error("PUT /api/ordens/[id]/orcamento", err);
    return NextResponse.json(
      { error: err?.message || "Falha ao salvar orçamento" },
      { status: 500 }
    );
  }
}
