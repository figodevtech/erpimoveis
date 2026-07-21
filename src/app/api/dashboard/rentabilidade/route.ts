import { NextResponse } from "next/server";
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
    const setoresResult = await supabaseAdmin.from("setor").select("id,nome").order("nome");
    if (setoresResult.error) throw setoresResult.error;
    const setores = setoresResult.data ?? [];

    let osQuery = supabaseAdmin
      .from("ordemservico")
      .select("id, status, orcamentototal, subtotal, dataentrada, datasaida, setor:setorid(id,nome), cliente:clienteid(nomerazaosocial)")
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

    if (!ids.length) {
      return NextResponse.json({
        filtros: { inicio, fim, status, setorId },
        setores,
        kpis: { faturamento: 0, recebidoLiquido: 0, custosProdutos: 0, comissoes: 0, taxas: 0, despesas: 0, lucroPrevisto: 0, lucroRealizado: 0, margemPrevista: 0, margemRealizada: 0, ordens: 0 },
        evolucao: [], composicao: [], setoresRentabilidade: [], produtos: [], ordens: [], qualidade: { estimados: 0, semCusto: 0 },
      });
    }

    const [produtosResult, servicosResult, comissoesResult, transacoesResult] = await Promise.all([
      supabaseAdmin.from("osproduto").select("ordemservicoid, produtoid, quantidade, subtotal, custo_unitario_aplicado, produto:produtoid(titulo,descricao,ultimovalordecompra)").in("ordemservicoid", ids),
      supabaseAdmin.from("osservico").select("ordemservicoid, servicoid, subtotal").in("ordemservicoid", ids),
      supabaseAdmin.from("osservico_realizador").select("ordemservicoid, servicoid, valor_comissao").in("ordemservicoid", ids),
      supabaseAdmin.from("transacao").select("ordemservicoid,tipo,valor,valorLiquido,pendente").in("ordemservicoid", ids).eq("is_deleted", false),
    ]);
    for (const result of [produtosResult, servicosResult, comissoesResult, transacoesResult]) if (result.error) throw result.error;

    const produtos = produtosResult.data ?? [];
    const servicos = servicosResult.data ?? [];
    const comissoes = comissoesResult.data ?? [];
    const transacoes = transacoesResult.data ?? [];
    const byOs = <T extends Record<string, any>>(rows: T[]) => rows.reduce<Record<number, T[]>>((map, row) => {
      (map[Number(row.ordemservicoid)] ??= []).push(row); return map;
    }, {});
    const produtosByOs = byOs(produtos as any[]);
    const servicosByOs = byOs(servicos as any[]);
    const comissoesByOs = byOs(comissoes as any[]);
    const transacoesByOs = byOs(transacoes as any[]);
    const produtoRanking = new Map<number, { produtoid: number; nome: string; receita: number; custo: number; lucro: number; quantidade: number }>();
    let estimados = 0;
    let semCusto = 0;

    const detalhes = ordens.map((os: any) => {
      const osId = Number(os.id);
      const itensProduto = produtosByOs[osId] ?? [];
      const itensServico = servicosByOs[osId] ?? [];
      const txs = transacoesByOs[osId] ?? [];
      const faturamento = num(os.orcamentototal);
      const subtotalItens = [...itensProduto, ...itensServico].reduce((sum, item) => sum + num(item.subtotal), 0);
      const fator = subtotalItens > 0 ? faturamento / subtotalItens : 1;
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
      return { id: osId, data: String(os.dataentrada).slice(0, 10), status: os.status, setor: setor?.nome || "Sem setor", cliente: cliente?.nomerazaosocial || "Não informado", faturamento, recebidoLiquido, custoProdutos, comissao, taxas, despesas, lucroPrevisto, lucroRealizado, margemPrevista: faturamento > 0 ? lucroPrevisto / faturamento * 100 : 0 };
    });

    const totals = detalhes.reduce((acc, item) => { for (const key of ["faturamento","recebidoLiquido","custoProdutos","comissao","taxas","despesas","lucroPrevisto","lucroRealizado"] as const) acc[key] += item[key]; return acc; }, { faturamento: 0, recebidoLiquido: 0, custoProdutos: 0, comissao: 0, taxas: 0, despesas: 0, lucroPrevisto: 0, lucroRealizado: 0 });
    const aggregate = (key: "data" | "setor") => Array.from(detalhes.reduce((map, item) => { const name = item[key]; const value = map.get(name) ?? { nome: name, faturamento: 0, custos: 0, lucro: 0 }; value.faturamento += item.faturamento; value.custos += item.custoProdutos + item.comissao + item.taxas + item.despesas; value.lucro += item.lucroPrevisto; map.set(name, value); return map; }, new Map<string, any>()).values());

    return NextResponse.json({
      filtros: { inicio, fim, status, setorId },
      setores,
      kpis: { ...totals, comissoes: totals.comissao, ordens: detalhes.length, margemPrevista: totals.faturamento > 0 ? totals.lucroPrevisto / totals.faturamento * 100 : 0, margemRealizada: totals.recebidoLiquido > 0 ? totals.lucroRealizado / totals.recebidoLiquido * 100 : 0 },
      evolucao: aggregate("data").map((item: any) => ({ ...item, data: item.nome })),
      composicao: [
        { nome: "Produtos", valor: totals.custoProdutos }, { nome: "Comissões", valor: totals.comissao },
        { nome: "Taxas", valor: totals.taxas }, { nome: "Despesas", valor: totals.despesas },
      ],
      setoresRentabilidade: aggregate("setor").sort((a: any, b: any) => b.lucro - a.lucro),
      produtos: Array.from(produtoRanking.values()).sort((a, b) => b.lucro - a.lucro).slice(0, 10),
      ordens: detalhes.sort((a, b) => b.lucroPrevisto - a.lucroPrevisto),
      qualidade: { estimados, semCusto },
    });
  } catch (error: any) {
    console.error("GET /api/dashboard/rentabilidade", error);
    return NextResponse.json({ error: error?.message || "Falha ao calcular rendimentos." }, { status: 500 });
  }
}
