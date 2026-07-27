// src/app/api/ordens/[id]/orcamento/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buscarModoBaixaEstoqueOS } from "@/lib/ordens/estoque-os";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // server role
  { auth: { persistSession: false, autoRefreshToken: false } }
);

type Num = number;
const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

type TipoDesconto = "FIXO" | "PORCENTAGEM" | null;

function sanitizeTipoDesconto(value: unknown): TipoDesconto {
  return value === "FIXO" || value === "PORCENTAGEM" ? value : null;
}

function arredondarMoeda(valor: number) {
  return Math.round((Number.isFinite(valor) ? valor : 0) * 100) / 100;
}

function calcularDescontoAplicado(base: number, tipo: TipoDesconto, desconto: number) {
  const baseSeguro = Math.max(0, toNum(base));
  const valor = Math.max(0, toNum(desconto));
  if (!tipo || valor <= 0 || baseSeguro <= 0) return 0;
  if (tipo === "PORCENTAGEM") return arredondarMoeda(baseSeguro * (Math.min(valor, 100) / 100));
  return arredondarMoeda(Math.min(valor, baseSeguro));
}

function calcularTotalComDesconto(base: number, tipo: TipoDesconto, desconto: number) {
  return arredondarMoeda(Math.max(0, toNum(base) - calcularDescontoAplicado(base, tipo, desconto)));
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
      .select("subtotal, desconto_tipo, desconto")
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
      descricao: String(r.produto?.descricao ?? r.produto?.titulo ?? ""),
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
        servicos,
        subtotal: toNum((osRow as any)?.subtotal ?? 0),
        descontoTipo: (osRow as any)?.desconto_tipo ?? null,
        desconto: toNum((osRow as any)?.desconto ?? 0),
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
    const descontoTipo = sanitizeTipoDesconto(body?.descontoTipo);
    const desconto = Math.max(0, toNum(body?.desconto ?? 0));

    const modoBaixaEstoqueOS = await buscarModoBaixaEstoqueOS();

    // Normaliza (não aceitaremos números negativos)
    const desejados = produtosBody
      .map((p) => ({
        produtoid: toNum(p.produtoid),
        quantidade: Math.max(0, toNum(p.quantidade)),
        precounitario: toNum(p.precounitario),
        descontoTipo: sanitizeTipoDesconto(p.descontoTipo),
        desconto: Math.max(0, toNum(p.desconto ?? 0)),
      }))
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

    // Busca estoques/títulos dos produtos envolvidos
    const { data: prodInfos, error: prodInfoErr } = allProdIds.length
      ? modoBaixaEstoqueOS === "ORCAMENTO"
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

    if (modoBaixaEstoqueOS === "ORCAMENTO") {
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
    if (modoBaixaEstoqueOS === "ORCAMENTO") {
      for (const pid of allProdIds) {
      const desejada = desejadosMap.get(pid)?.quantidade ?? 0;
      const baixadaAtual = baixaMap.get(pid) ?? 0;
      const delta = desejada - baixadaAtual; // + => consumir estoque; - => devolver
      if (delta === 0) {
        // Garante que a baixa reflita a desejada (mesmo se 0 -> deletar)
        if (desejada === 0 && baixadaAtual > 0) {
          // remover controle de baixa
          const delBaixa = await supabase
            .from("osproduto_baixa")
            .delete()
            .eq("ordemservicoid", osId)
            .eq("produtoid", pid);
          if (delBaixa.error) throw delBaixa.error;
        } else if (desejada > 0 && baixadaAtual !== desejada) {
          // alinhar exatamente
          const upBaixa = await supabase.from("osproduto_baixa").upsert(
            [{ ordemservicoid: osId, produtoid: pid, quantidade: desejada }],
            { onConflict: "ordemservicoid,produtoid" }
          );
          if (upBaixa.error) throw upBaixa.error;
        }
        continue;
      }

      // Atualiza controle de baixa
      if (desejada === 0) {
        const delBaixa = await supabase
          .from("osproduto_baixa")
          .delete()
          .eq("ordemservicoid", osId)
          .eq("produtoid", pid);
        if (delBaixa.error) throw delBaixa.error;
      } else {
        const upBaixa = await supabase.from("osproduto_baixa").upsert(
          [{ ordemservicoid: osId, produtoid: pid, quantidade: desejada }],
          { onConflict: "ordemservicoid,produtoid" }
        );
        if (upBaixa.error) throw upBaixa.error;
      }

      // Atualiza estoque do produto (set absoluto com base no que lemos)
      const estoqueAtual = estoqueMap.get(pid) ?? 0;
      const novoEstoque = estoqueAtual - delta; // delta>0 consome; delta<0 devolve
      const upEst = await supabase
        .from("produto")
        .update({ estoque: novoEstoque })
        .eq("id", pid);
      if (upEst.error) throw upEst.error;

      // Atualiza cache local p/ próximo loop (evita inconsistências se mesmo id repetir)
      estoqueMap.set(pid, novoEstoque);
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
          const itemDesconto = Math.max(0, toNum(s.desconto ?? 0));

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

    // 4) Atualiza total geral da OS
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
        Math.max(0, toNum(s.desconto ?? 0))
      );
    }, 0);
    const subtotal = arredondarMoeda(totalProdutos + totalServicos);
    const totalGeral = calcularTotalComDesconto(subtotal, descontoTipo, desconto);

    const { data: transacoes, error: transacoesErr } = await supabase
      .from("transacao")
      .select("valor")
      .eq("ordemservicoid", osId)
      .eq("tipo", "RECEITA");

    if (transacoesErr) throw transacoesErr;

    const totalPago = (transacoes ?? []).reduce((acc: number, row: any) => acc + toNum(row.valor), 0);
    if (totalGeral < totalPago) {
      return NextResponse.json(
        {
          error: `O total com desconto nÃ£o pode ficar menor que o total jÃ¡ pago (${totalPago.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).`,
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
        orcamentototal: totalGeral,
      })
      .eq("id", osId);
    if (updOS.error) throw updOS.error;

    if (["ORCAMENTO_APROVADO", "EM_ANDAMENTO", "PAGAMENTO"].includes(statusAtual)) {
      const { error: reconciliacaoError } = await supabase.rpc("reconciliar_eventos_financeiros_os", {
        p_ordemservicoid: osId,
        p_incluir_comissoes: ["EM_ANDAMENTO", "PAGAMENTO"].includes(statusAtual),
      });
      if (reconciliacaoError) throw reconciliacaoError;
    }

    return NextResponse.json({ ok: true, totalGeral });
  } catch (err: any) {
    console.error("PUT /api/ordens/[id]/orcamento", err);
    return NextResponse.json(
      { error: err?.message || "Falha ao salvar orçamento" },
      { status: 500 }
    );
  }
}
