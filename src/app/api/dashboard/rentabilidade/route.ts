import { NextResponse } from "next/server";
import { carregarFatiasRateadas, fatiaComoTransacao } from "@/lib/financeiro/rateio-documentos";
import { requireDashboardAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const relation = <T,>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

function defaultStart() {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  try {
    await requireDashboardAccess();
    const params = new URL(request.url).searchParams;
    const inicio = params.get("inicio") || defaultStart();
    const fim = params.get("fim") || new Date().toISOString().slice(0, 10);
    const status = params.get("status") || "TODOS";
    const setorId = Number(params.get("setorId") || 0);
    const origem = params.get("origem") || "TODAS";
    const setoresResult = await supabaseAdmin.from("setor").select("id,nome").order("nome");
    if (setoresResult.error) throw setoresResult.error;
    const setores = setoresResult.data ?? [];

    let osQuery = supabaseAdmin
      .from("ordemservico")
      .select("id, status, orcamentototal, valor_frete, subtotal, dataentrada, datasaida, setor:setorid(id,nome), cliente:clienteid(nomerazaosocial)")
      .gte("dataentrada", `${inicio}T00:00:00-03:00`)
      .lte("dataentrada", `${fim}T23:59:59-03:00`)
      .order("dataentrada", { ascending: true })
      .limit(2000);
    if (status !== "TODOS") osQuery = osQuery.eq("status", status);
    if (setorId > 0) osQuery = osQuery.eq("setorid", setorId);

    const osResult = await osQuery;
    if (osResult.error) throw osResult.error;
    const ordens = osResult.data ?? [];
    const ids = ordens.map((os: any) => Number(os.id));

    const vendasQuery = supabaseAdmin
      .from("venda")
      .select("id,status,valortotal,sub_total,datavenda,createdat,comissao_venda_percent_aplicada,cliente:clienteid(nomerazaosocial)")
      .gte("datavenda", `${inicio}T00:00:00-03:00`)
      .lte("datavenda", `${fim}T23:59:59-03:00`)
      .not("status", "in", "(CANCELADA,CANCELADO,ORCAMENTO)")
      .limit(2000);
    const vendasResult = await vendasQuery;
    if (vendasResult.error) throw vendasResult.error;
    const vendas = status === "TODOS" ? (vendasResult.data ?? []) : [];
    const vendaIds = vendas.map((venda: any) => Number(venda.id));

    if (!ids.length && !vendaIds.length) {
      return NextResponse.json({
        filtros: { inicio, fim, status, setorId, origem },
        setores,
        kpis: { faturamento: 0, recebidoLiquido: 0, custosProdutos: 0, comissoes: 0, taxas: 0, despesas: 0, lucroPrevisto: 0, lucroRealizado: 0, margemPrevista: 0, margemRealizada: 0, ordens: 0 },
        evolucao: [], composicao: [], setoresRentabilidade: [], produtos: [], ordens: [], qualidade: { estimados: 0, semCusto: 0 },
      });
    }

    const [produtosResult, servicosResult, comissoesResult, transacoesResult, vendaProdutosResult, vendaTransacoesResult, mlOrdersResult] = await Promise.all([
      supabaseAdmin.from("osproduto").select("ordemservicoid, produtoid, quantidade, subtotal, custo_unitario_aplicado, produto:produtoid(titulo,descricao,ultimovalordecompra)").in("ordemservicoid", ids.length ? ids : [-1]),
      supabaseAdmin.from("osservico").select("ordemservicoid, servicoid, subtotal").in("ordemservicoid", ids.length ? ids : [-1]),
      supabaseAdmin.from("osservico_realizador").select("ordemservicoid, servicoid, valor_comissao").in("ordemservicoid", ids.length ? ids : [-1]),
      supabaseAdmin.from("transacao").select("ordemservicoid,tipo,valor,valorLiquido,pendente").in("ordemservicoid", ids.length ? ids : [-1]).eq("is_deleted", false),
      supabaseAdmin.from("vendaproduto").select("venda_id,produtoid,quantidade,valor_total,custo_unitario_aplicado,produto:produtoid(titulo,descricao,ultimovalordecompra)").in("venda_id", vendaIds.length ? vendaIds : [-1]),
      supabaseAdmin.from("transacao").select("vendaid,tipo,valor,valorLiquido,pendente").in("vendaid", vendaIds.length ? vendaIds : [-1]).eq("is_deleted", false),
      supabaseAdmin.from("mercadolivre_order").select("venda_id").in("venda_id", vendaIds.length ? vendaIds : [-1]),
    ]);
    for (const result of [produtosResult, servicosResult, comissoesResult, transacoesResult, vendaProdutosResult, vendaTransacoesResult, mlOrdersResult]) if (result.error) throw result.error;

    const produtos = produtosResult.data ?? [];
    const servicos = servicosResult.data ?? [];
    const comissoes = comissoesResult.data ?? [];
    // As fatias do pagamento múltiplo entram como se fossem transações do
    // documento: sem elas o recebido da OS ou da venda paga em grupo sai zerado.
    const [fatiasOs, fatiasVendas] = await Promise.all([
      carregarFatiasRateadas("OS", ids),
      carregarFatiasRateadas("VENDA", vendaIds),
    ]);
    const transacoes = [
      ...(transacoesResult.data ?? []),
      ...[...fatiasOs.values()].flat().map((fatia) => ({
        ordemservicoid: fatia.documentoId,
        tipo: "RECEITA",
        valor: fatia.valor,
        valorLiquido: fatia.valor,
        pendente: fatia.pendente,
      })),
    ];
    const vendaProdutos = vendaProdutosResult.data ?? [];
    const vendaTransacoes = [
      ...(vendaTransacoesResult.data ?? []),
      ...[...fatiasVendas.values()].flat().map((fatia) => ({
        vendaid: fatia.documentoId,
        tipo: "RECEITA",
        valor: fatia.valor,
        valorLiquido: fatia.valor,
        pendente: fatia.pendente,
      })),
    ];
    const mlVendaIds = new Set((mlOrdersResult.data ?? []).map((item: any) => Number(item.venda_id)));
    const byOs = <T extends Record<string, any>>(rows: T[]) => rows.reduce<Record<number, T[]>>((map, row) => {
      (map[Number(row.ordemservicoid)] ??= []).push(row); return map;
    }, {});
    const produtosByOs = byOs(produtos as any[]);
    const servicosByOs = byOs(servicos as any[]);
    const comissoesByOs = byOs(comissoes as any[]);
    const transacoesByOs = byOs(transacoes as any[]);
    const vendaProdutosByVenda = (vendaProdutos as any[]).reduce<Record<number, any[]>>((map, row) => { (map[Number(row.venda_id)] ??= []).push(row); return map; }, {});
    const vendaTransacoesByVenda = (vendaTransacoes as any[]).reduce<Record<number, any[]>>((map, row) => { (map[Number(row.vendaid)] ??= []).push(row); return map; }, {});
    const produtoRanking = new Map<number, { produtoid: number; nome: string; receita: number; custo: number; lucro: number; quantidade: number }>();
    let estimados = 0;
    let semCusto = 0;

    const detalhes = ordens.map((os: any) => {
      const osId = Number(os.id);
      const itensProduto = produtosByOs[osId] ?? [];
      const itensServico = servicosByOs[osId] ?? [];
      const txs = transacoesByOs[osId] ?? [];
      const faturamento = num(os.orcamentototal);
      const frete = num(os.valor_frete);
      const subtotalItens = [...itensProduto, ...itensServico].reduce((sum, item) => sum + num(item.subtotal), 0);
      const fator = subtotalItens > 0 ? Math.max(0, faturamento - frete) / subtotalItens : 1;
      let custoProdutos = 0;
      for (const item of itensProduto) {
        const produto: any = relation(item.produto as any);
        const atual = produto?.ultimovalordecompra;
        const estimado = item.custo_unitario_aplicado == null && atual != null;
        const ausente = item.custo_unitario_aplicado == null && atual == null;
        if (estimado) estimados += 1;
        if (ausente) semCusto += 1;
        const custo = (item.custo_unitario_aplicado == null ? num(atual) : num(item.custo_unitario_aplicado)) * num(item.quantidade);
        const receita = num(item.subtotal) * fator;
        custoProdutos += custo;
        const key = Number(item.produtoid);
        const atualRanking = produtoRanking.get(key) ?? { produtoid: key, nome: produto?.titulo || produto?.descricao || "Produto", receita: 0, custo: 0, lucro: 0, quantidade: 0 };
        atualRanking.receita += receita; atualRanking.custo += custo; atualRanking.lucro += receita - custo; atualRanking.quantidade += num(item.quantidade);
        produtoRanking.set(key, atualRanking);
      }
      const comissao = (comissoesByOs[osId] ?? []).reduce((sum, item) => sum + num(item.valor_comissao), 0);
      const receitasPagas = txs.filter((tx) => tx.tipo === "RECEITA" && !tx.pendente);
      const despesasOs = txs.filter((tx) => tx.tipo === "DESPESA");
      const recebidoBruto = receitasPagas.reduce((sum, tx) => sum + num(tx.valor), 0);
      const recebidoLiquido = receitasPagas.reduce((sum, tx) => sum + num(tx.valorLiquido ?? tx.valor), 0);
      const taxas = Math.max(0, recebidoBruto - recebidoLiquido);
      const despesas = despesasOs.reduce((sum, tx) => sum + num(tx.valor), 0);
      const despesasPagas = despesasOs.filter((tx) => !tx.pendente).reduce((sum, tx) => sum + num(tx.valorLiquido ?? tx.valor), 0);
      const lucroPrevisto = faturamento - custoProdutos - comissao - despesas;
      const lucroRealizado = recebidoLiquido - custoProdutos - comissao - despesasPagas;
      const setor: any = relation(os.setor);
      const cliente: any = relation(os.cliente);
      return { id: osId, origem: "OS", data: String(os.dataentrada).slice(0, 10), status: os.status, setor: setor?.nome || "Sem setor", cliente: cliente?.nomerazaosocial || "Não informado", faturamento, recebidoLiquido, custoProdutos, comissao, taxas, despesas, lucroPrevisto, lucroRealizado, margemPrevista: faturamento > 0 ? lucroPrevisto / faturamento * 100 : 0 };
    });

    const detalhesVendas = vendas.map((venda: any) => {
      const vendaId = Number(venda.id);
      const itens = vendaProdutosByVenda[vendaId] ?? [];
      const faturamento = num(venda.valortotal);
      let custoProdutos = 0;
      for (const item of itens) {
        const produto: any = relation(item.produto);
        const atual = produto?.ultimovalordecompra;
        if (item.custo_unitario_aplicado == null && atual != null) estimados += 1;
        if (item.custo_unitario_aplicado == null && atual == null) semCusto += 1;
        const custo = (item.custo_unitario_aplicado == null ? num(atual) : num(item.custo_unitario_aplicado)) * num(item.quantidade);
        const receita = num(item.valor_total);
        custoProdutos += custo;
        const key = Number(item.produtoid);
        const atualRanking = produtoRanking.get(key) ?? { produtoid: key, nome: produto?.titulo || produto?.descricao || "Produto", receita: 0, custo: 0, lucro: 0, quantidade: 0 };
        atualRanking.receita += receita; atualRanking.custo += custo; atualRanking.lucro += receita - custo; atualRanking.quantidade += num(item.quantidade);
        produtoRanking.set(key, atualRanking);
      }
      const txs = vendaTransacoesByVenda[vendaId] ?? [];
      const receitasPagas = txs.filter((tx) => tx.tipo === "RECEITA" && !tx.pendente);
      const recebidoBruto = receitasPagas.reduce((sum, tx) => sum + num(tx.valor), 0);
      const recebidoLiquido = receitasPagas.reduce((sum, tx) => sum + num(tx.valorLiquido ?? tx.valor), 0);
      const taxas = Math.max(0, recebidoBruto - recebidoLiquido);
      const comissao = faturamento * num(venda.comissao_venda_percent_aplicada) / 100;
      const lucroPrevisto = faturamento - custoProdutos - comissao - taxas;
      const lucroRealizado = recebidoLiquido - custoProdutos - comissao;
      const cliente: any = relation(venda.cliente);
      return { id: vendaId, origem: mlVendaIds.has(vendaId) ? "MERCADO_LIVRE" : "PDV", data: String(venda.datavenda ?? venda.createdat).slice(0, 10), status: venda.status, setor: mlVendaIds.has(vendaId) ? "Mercado Livre" : "PDV", cliente: cliente?.nomerazaosocial || "Não informado", faturamento, recebidoLiquido, custoProdutos, comissao, taxas, despesas: 0, lucroPrevisto, lucroRealizado, margemPrevista: faturamento > 0 ? lucroPrevisto / faturamento * 100 : 0 };
    });

    detalhes.push(...detalhesVendas);
    const detalhesFiltrados = origem === "TODAS"
      ? detalhes
      : detalhes.filter((item) => item.origem === origem);

    const totals = detalhesFiltrados.reduce((acc, item) => { for (const key of ["faturamento","recebidoLiquido","custoProdutos","comissao","taxas","despesas","lucroPrevisto","lucroRealizado"] as const) acc[key] += item[key]; return acc; }, { faturamento: 0, recebidoLiquido: 0, custoProdutos: 0, comissao: 0, taxas: 0, despesas: 0, lucroPrevisto: 0, lucroRealizado: 0 });
    const aggregate = (key: "data" | "setor") => Array.from(detalhesFiltrados.reduce((map, item) => { const name = item[key]; const value = map.get(name) ?? { nome: name, faturamento: 0, recebidoLiquido: 0, custos: 0, lucroPrevisto: 0, lucroRealizado: 0 }; value.faturamento += item.faturamento; value.recebidoLiquido += item.recebidoLiquido; value.custos += item.custoProdutos + item.comissao + item.taxas + item.despesas; value.lucroPrevisto += item.lucroPrevisto; value.lucroRealizado += item.lucroRealizado; map.set(name, value); return map; }, new Map<string, any>()).values());

    return NextResponse.json({
      filtros: { inicio, fim, status, setorId, origem },
      setores,
      kpis: { ...totals, comissoes: totals.comissao, ordens: detalhesFiltrados.length, margemPrevista: totals.faturamento > 0 ? totals.lucroPrevisto / totals.faturamento * 100 : 0, margemRealizada: totals.recebidoLiquido > 0 ? totals.lucroRealizado / totals.recebidoLiquido * 100 : 0 },
      evolucao: aggregate("data").map((item: any) => ({ ...item, data: item.nome })),
      composicao: [
        { nome: "Produtos", valor: totals.custoProdutos }, { nome: "Comissões", valor: totals.comissao },
        { nome: "Taxas", valor: totals.taxas }, { nome: "Despesas", valor: totals.despesas },
      ],
      setoresRentabilidade: aggregate("setor").sort((a: any, b: any) => b.lucroPrevisto - a.lucroPrevisto),
      produtos: Array.from(produtoRanking.values()).sort((a, b) => b.lucro - a.lucro).slice(0, 10),
      ordens: detalhesFiltrados.sort((a, b) => b.lucroPrevisto - a.lucroPrevisto),
      prejuizos: [...detalhesFiltrados].filter((item) => item.lucroPrevisto < 0).sort((a, b) => a.lucroPrevisto - b.lucroPrevisto).slice(0, 10),
      qualidade: { estimados, semCusto },
    });
  } catch (error: any) {
    console.error("GET /api/dashboard/rentabilidade", error);
    return NextResponse.json({ error: error?.message || "Falha ao calcular rendimentos." }, { status: 500 });
  }
}
