import { NextResponse } from "next/server";
import { requireDashboardAccess } from "@/app/api/_authz/perms";
import { carregarFatiasRateadas } from "@/lib/financeiro/rateio-documentos";
import { valorLiquidoEfetivo } from "@/lib/financeiro/transacao";
import { lerComissaoVenda } from "@/lib/vendas/comissao";
import { fetchAllSupabaseRows, fetchAllSupabaseRowsByChunks } from "@/lib/supabase-pagination";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ZONE = "America/Fortaleza";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_OPERACIONAIS = ["ORCAMENTO_APROVADO", "EM_ANDAMENTO", "PAGAMENTO", "FATURAMENTO", "CONCLUIDO", "SEM_COBRANCA"];
const ORIGENS = new Set(["TODAS", "OS", "PDV", "MERCADO_LIVRE"]);

const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const relation = <T,>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

function localDateKey(date: Date | string = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof date === "string" ? new Date(date) : date);
}

type TransacaoRentabilidade = {
  id: number;
  tipo: string;
  valor: number | string | null;
  valorLiquido: number | string | null;
  valor_descontos: number | string | null;
  pendente: boolean;
  valor_baixado?: number | string | null;
  adiantamento_id?: number | null;
  rateado?: boolean;
};

function transacoesRealizadas(
  transacoes: TransacaoRentabilidade[],
  baixasPorTitulo: Map<number, TransacaoRentabilidade[]>,
) {
  return transacoes.flatMap((transacao) => {
    if (transacao.rateado) return transacao.pendente ? [] : [transacao];
    const baixas = baixasPorTitulo.get(Number(transacao.id)) ?? [];
    if (baixas.length > 0) return baixas.filter((baixa) => !baixa.pendente);
    return transacao.pendente ? [] : [transacao];
  });
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00-03:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function emptyResponse(
  filtros: { inicio: string; fim: string; status: string; setorId: number; origem: string },
  setores: any[],
) {
  return {
    filtros,
    setores,
    kpis: {
      faturamento: 0,
      recebidoLiquido: 0,
      custosProdutos: 0,
      custoProdutos: 0,
      comissoes: 0,
      taxas: 0,
      despesas: 0,
      lucroPrevisto: 0,
      lucroRealizado: 0,
      margemPrevista: 0,
      margemRealizada: 0,
      ordens: 0,
    },
    evolucao: [],
    composicao: [],
    setoresRentabilidade: [],
    produtos: [],
    ordens: [],
    prejuizos: [],
    qualidade: { estimados: 0, semCusto: 0, itensAvaliados: 0 },
  };
}

type ProdutoContribuicao = {
  registro: string;
  produtoid: number;
  nome: string;
  receita: number;
  custo: number;
  lucro: number;
  quantidade: number;
  estimado: boolean;
  semCusto: boolean;
};

export async function GET(request: Request) {
  try {
    await requireDashboardAccess();

    const params = new URL(request.url).searchParams;
    const hoje = localDateKey();
    const inicio = params.get("inicio") || shiftIsoDate(hoje, -29);
    const fim = params.get("fim") || hoje;
    const status = params.get("status") || "TODOS";
    const setorParam = Number(params.get("setorId") || 0);
    const setorId = Number.isInteger(setorParam) && setorParam > 0 ? setorParam : 0;
    const origemParam = params.get("origem") || "TODAS";
    const origem = ORIGENS.has(origemParam) ? origemParam : "TODAS";
    const filtros = { inicio, fim, status, setorId, origem };

    if (!ISO_DATE.test(inicio) || !ISO_DATE.test(fim) || inicio > fim) {
      return NextResponse.json({ error: "Período inválido." }, { status: 400 });
    }

    const setores = await fetchAllSupabaseRows<any>(() =>
      supabaseAdmin.from("setor").select("id,nome").order("nome", { ascending: true }).order("id", { ascending: true }),
    );

    const incluirOs = origem === "TODAS" || origem === "OS";
    const incluirVendas = status === "TODOS" && setorId === 0 && origem !== "OS";

    const ordens = incluirOs
      ? await fetchAllSupabaseRows<any>(() => {
          let query = supabaseAdmin
            .from("ordemservico")
            .select(
              "id,status,orcamentototal,valor_frete,subtotal,dataentrada,datasaida,setor:setorid(id,nome),cliente:clienteid(nomerazaosocial)",
            )
            .eq("is_deleted", false)
            .is("migracao_referencia", null)
            .gte("dataentrada", `${inicio}T00:00:00-03:00`)
            .lte("dataentrada", `${fim}T23:59:59-03:00`)
            .order("dataentrada", { ascending: true })
            .order("id", { ascending: true });
          query = status === "TODOS" ? query.in("status", STATUS_OPERACIONAIS) : query.eq("status", status);
          if (setorId > 0) query = query.eq("setorid", setorId);
          return query;
        })
      : [];

    const vendas = incluirVendas
      ? await fetchAllSupabaseRows<any>(() =>
          supabaseAdmin
            .from("venda")
            .select(
              "id,status,valortotal,sub_total,valor_frete,datavenda,createdat,comissao:venda_comissao(base,percentual,valor_comissao),cliente:clienteid(nomerazaosocial)",
            )
            .gte("datavenda", `${inicio}T00:00:00-03:00`)
            .lte("datavenda", `${fim}T23:59:59-03:00`)
            .in("status", ["PAGAMENTO", "FINALIZADA", "PAGO", "AUTORIZADO"])
            .order("datavenda", { ascending: true })
            .order("id", { ascending: true }),
        )
      : [];

    const ids = ordens.map((os) => Number(os.id));
    const vendaIds = vendas.map((venda) => Number(venda.id));

    if (!ids.length && !vendaIds.length) {
      return NextResponse.json(emptyResponse(filtros, setores));
    }

    const [produtos, servicos, comissoes, transacoesDiretas, vendaProdutos, vendaTransacoesDiretas, mlOrders] =
      await Promise.all([
        fetchAllSupabaseRowsByChunks<any, number>(ids, (lote) =>
          supabaseAdmin
            .from("osproduto")
            .select(
              "ordemservicoid,produtoid,quantidade,subtotal,custo_unitario_aplicado,produto:produtoid(titulo,descricao,ultimovalordecompra)",
            )
            .in("ordemservicoid", lote)
            .order("ordemservicoid", { ascending: true }),
        ),
        fetchAllSupabaseRowsByChunks<any, number>(ids, (lote) =>
          supabaseAdmin
            .from("osservico")
            .select("ordemservicoid,servicoid,subtotal")
            .in("ordemservicoid", lote)
            .order("ordemservicoid", { ascending: true }),
        ),
        fetchAllSupabaseRowsByChunks<any, number>(ids, (lote) =>
          supabaseAdmin
            .from("osservico_realizador")
            .select("ordemservicoid,servicoid,valor_comissao")
            .in("ordemservicoid", lote)
            .order("ordemservicoid", { ascending: true }),
        ),
        fetchAllSupabaseRowsByChunks<any, number>(ids, (lote) =>
          supabaseAdmin
            .from("transacao")
            .select("id,ordemservicoid,tipo,valor,valorLiquido,valor_descontos,valor_baixado,adiantamento_id,pendente")
            .in("ordemservicoid", lote)
            .eq("is_deleted", false)
            .order("ordemservicoid", { ascending: true }),
        ),
        fetchAllSupabaseRowsByChunks<any, number>(vendaIds, (lote) =>
          supabaseAdmin
            .from("vendaproduto")
            .select(
              "venda_id,produtoid,quantidade,valor_total,custo_unitario_aplicado,produto:produtoid(titulo,descricao,ultimovalordecompra)",
            )
            .in("venda_id", lote)
            .order("venda_id", { ascending: true }),
        ),
        fetchAllSupabaseRowsByChunks<any, number>(vendaIds, (lote) =>
          supabaseAdmin
            .from("transacao")
            .select("id,vendaid,tipo,valor,valorLiquido,valor_descontos,valor_baixado,adiantamento_id,pendente")
            .in("vendaid", lote)
            .eq("is_deleted", false)
            .order("vendaid", { ascending: true }),
        ),
        fetchAllSupabaseRowsByChunks<any, number>(vendaIds, (lote) =>
          supabaseAdmin
            .from("mercadolivre_order")
            .select("venda_id")
            .in("venda_id", lote)
            .order("venda_id", { ascending: true }),
        ),
      ]);

    // Pagamentos múltiplos não apontam diretamente para a OS/venda. As fatias
    // recolocam em cada documento somente a parte do recebimento que lhe cabe.
    const [fatiasOs, fatiasVendas] = await Promise.all([
      carregarFatiasRateadas("OS", ids),
      carregarFatiasRateadas("VENDA", vendaIds),
    ]);
    const titulosDiretos = [...transacoesDiretas, ...vendaTransacoesDiretas];
    const baixas = await fetchAllSupabaseRowsByChunks<any, number>(
      titulosDiretos.map((transacao) => Number(transacao.id)),
      (lote) =>
        supabaseAdmin
          .from("transacao")
          .select("id,baixa_de_transacao_id,tipo,valor,valorLiquido,valor_descontos,pendente")
          .in("baixa_de_transacao_id", lote)
          .eq("is_deleted", false)
          .order("id", { ascending: true }),
    );
    const baixasPorTitulo = baixas.reduce<Map<number, TransacaoRentabilidade[]>>((map, baixa) => {
      const tituloId = Number(baixa.baixa_de_transacao_id);
      const lista = map.get(tituloId);
      if (lista) lista.push(baixa);
      else map.set(tituloId, [baixa]);
      return map;
    }, new Map());
    const transacoes = [
      ...transacoesDiretas,
      ...[...fatiasOs.values()].flat().map((fatia) => ({
        ordemservicoid: fatia.documentoId,
        tipo: "RECEITA",
        valor: fatia.valor,
        valorLiquido: fatia.valorLiquido,
        valor_descontos: 0,
        pendente: fatia.pendente,
        rateado: true,
      })),
    ];
    const vendaTransacoes = [
      ...vendaTransacoesDiretas,
      ...[...fatiasVendas.values()].flat().map((fatia) => ({
        vendaid: fatia.documentoId,
        tipo: "RECEITA",
        valor: fatia.valor,
        valorLiquido: fatia.valorLiquido,
        valor_descontos: 0,
        pendente: fatia.pendente,
        rateado: true,
      })),
    ];

    const byOs = <T extends Record<string, any>>(rows: T[]) =>
      rows.reduce<Record<number, T[]>>((map, row) => {
        (map[Number(row.ordemservicoid)] ??= []).push(row);
        return map;
      }, {});
    const produtosByOs = byOs(produtos);
    const servicosByOs = byOs(servicos);
    const comissoesByOs = byOs(comissoes);
    const transacoesByOs = byOs(transacoes);
    const vendaProdutosByVenda = vendaProdutos.reduce<Record<number, any[]>>((map, row) => {
      (map[Number(row.venda_id)] ??= []).push(row);
      return map;
    }, {});
    const vendaTransacoesByVenda = vendaTransacoes.reduce<Record<number, any[]>>((map, row) => {
      (map[Number(row.vendaid)] ??= []).push(row);
      return map;
    }, {});
    const mlVendaIds = new Set(mlOrders.map((item) => Number(item.venda_id)));
    const contribuicoesProdutos: ProdutoContribuicao[] = [];

    const detalhesOs = ordens.map((os) => {
      const osId = Number(os.id);
      const registro = `OS:${osId}`;
      const itensProduto = produtosByOs[osId] ?? [];
      const itensServico = servicosByOs[osId] ?? [];
      const txs = transacoesByOs[osId] ?? [];
      const faturamento = os.status === "SEM_COBRANCA" ? 0 : num(os.orcamentototal);
      const frete = num(os.valor_frete);
      const subtotalItens = [...itensProduto, ...itensServico].reduce((sum, item) => sum + num(item.subtotal), 0);
      const fator = subtotalItens > 0 ? Math.max(0, faturamento - frete) / subtotalItens : 1;
      let custoProdutos = 0;

      for (const item of itensProduto) {
        const produto: any = relation(item.produto);
        const snapshot = num(item.custo_unitario_aplicado);
        const custoAtual = num(produto?.ultimovalordecompra);
        const temSnapshot = snapshot > 0;
        const estimado = !temSnapshot && custoAtual > 0;
        const semCusto = !temSnapshot && !estimado;
        const custo = (temSnapshot ? snapshot : estimado ? custoAtual : 0) * num(item.quantidade);
        const receita = num(item.subtotal) * fator;
        custoProdutos += custo;
        contribuicoesProdutos.push({
          registro,
          produtoid: Number(item.produtoid),
          nome: produto?.titulo || produto?.descricao || "Produto",
          receita,
          custo,
          lucro: receita - custo,
          quantidade: num(item.quantidade),
          estimado,
          semCusto,
        });
      }

      const comissao = (comissoesByOs[osId] ?? []).reduce((sum, item) => sum + num(item.valor_comissao), 0);
      const txsRealizadas = transacoesRealizadas(txs, baixasPorTitulo);
      const receitasPagas = txsRealizadas.filter((tx) => tx.tipo === "RECEITA");
      const despesasOs = txs.filter((tx) => tx.tipo === "DESPESA");
      const despesasOsPagas = transacoesRealizadas(despesasOs, baixasPorTitulo);
      const recebidoBruto = receitasPagas.reduce((sum, tx) => sum + num(tx.valor), 0);
      const recebidoLiquido = receitasPagas.reduce((sum, tx) => sum + valorLiquidoEfetivo(tx), 0);
      const taxas = Math.max(0, recebidoBruto - recebidoLiquido);
      const despesas = despesasOs.reduce((sum, tx) => sum + num(tx.valor), 0);
      const despesasPagas = despesasOsPagas.reduce((sum, tx) => sum + valorLiquidoEfetivo(tx), 0);
      const lucroPrevisto = faturamento - custoProdutos - comissao - taxas - despesas;
      const lucroRealizado = recebidoLiquido - custoProdutos - comissao - despesasPagas;
      const setor: any = relation(os.setor);
      const cliente: any = relation(os.cliente);

      return {
        registro,
        id: osId,
        origem: "OS",
        data: localDateKey(os.dataentrada),
        status: os.status,
        setor: setor?.nome || "Sem setor",
        cliente: cliente?.nomerazaosocial || "Não informado",
        faturamento,
        recebidoLiquido,
        custoProdutos,
        comissao,
        taxas,
        despesas,
        custosPrevistos: custoProdutos + comissao + taxas + despesas,
        custosRealizados: custoProdutos + comissao + despesasPagas,
        lucroPrevisto,
        lucroRealizado,
        margemPrevista: faturamento > 0 ? (lucroPrevisto / faturamento) * 100 : 0,
      };
    });

    const detalhesVendas = vendas.map((venda) => {
      const vendaId = Number(venda.id);
      const origemVenda = mlVendaIds.has(vendaId) ? "MERCADO_LIVRE" : "PDV";
      const registro = `${origemVenda}:${vendaId}`;
      const itens = vendaProdutosByVenda[vendaId] ?? [];
      const faturamento = num(venda.valortotal);
      let custoProdutos = 0;

      for (const item of itens) {
        const produto: any = relation(item.produto);
        const snapshot = num(item.custo_unitario_aplicado);
        const custoAtual = num(produto?.ultimovalordecompra);
        const temSnapshot = snapshot > 0;
        const estimado = !temSnapshot && custoAtual > 0;
        const semCusto = !temSnapshot && !estimado;
        const custo = (temSnapshot ? snapshot : estimado ? custoAtual : 0) * num(item.quantidade);
        const receita = num(item.valor_total);
        custoProdutos += custo;
        contribuicoesProdutos.push({
          registro,
          produtoid: Number(item.produtoid),
          nome: produto?.titulo || produto?.descricao || "Produto",
          receita,
          custo,
          lucro: receita - custo,
          quantidade: num(item.quantidade),
          estimado,
          semCusto,
        });
      }

      const txs = vendaTransacoesByVenda[vendaId] ?? [];
      const receitasPagas = transacoesRealizadas(txs, baixasPorTitulo).filter((tx) => tx.tipo === "RECEITA");
      const recebidoBruto = receitasPagas.reduce((sum, tx) => sum + num(tx.valor), 0);
      const recebidoLiquido = receitasPagas.reduce((sum, tx) => sum + valorLiquidoEfetivo(tx), 0);
      const taxas = Math.max(0, recebidoBruto - recebidoLiquido);
      // A comiss?o ? lida do snapshot, como nos relat?rios e na Central Pessoal.
      const comissao = lerComissaoVenda(venda.comissao)?.valor_comissao ?? 0;
      const lucroPrevisto = faturamento - custoProdutos - comissao - taxas;
      const lucroRealizado = recebidoLiquido - custoProdutos - comissao;
      const cliente: any = relation(venda.cliente);

      return {
        registro,
        id: vendaId,
        origem: origemVenda,
        data: localDateKey(venda.datavenda ?? venda.createdat),
        status: venda.status,
        setor: origemVenda === "MERCADO_LIVRE" ? "Mercado Livre" : "PDV",
        cliente: cliente?.nomerazaosocial || "Não informado",
        faturamento,
        recebidoLiquido,
        custoProdutos,
        comissao,
        taxas,
        despesas: 0,
        custosPrevistos: custoProdutos + comissao + taxas,
        custosRealizados: custoProdutos + comissao,
        lucroPrevisto,
        lucroRealizado,
        margemPrevista: faturamento > 0 ? (lucroPrevisto / faturamento) * 100 : 0,
      };
    });

    const detalhes = [...detalhesOs, ...detalhesVendas];
    const detalhesFiltrados = origem === "TODAS" ? detalhes : detalhes.filter((item) => item.origem === origem);
    const registrosSelecionados = new Set(detalhesFiltrados.map((item) => item.registro));
    const produtoRanking = new Map<
      number,
      { produtoid: number; nome: string; receita: number; custo: number; lucro: number; quantidade: number }
    >();
    let estimados = 0;
    let semCusto = 0;
    let itensAvaliados = 0;

    for (const item of contribuicoesProdutos) {
      if (!registrosSelecionados.has(item.registro)) continue;
      itensAvaliados += 1;
      if (item.estimado) estimados += 1;
      if (item.semCusto) semCusto += 1;
      const atual = produtoRanking.get(item.produtoid) ?? {
        produtoid: item.produtoid,
        nome: item.nome,
        receita: 0,
        custo: 0,
        lucro: 0,
        quantidade: 0,
      };
      atual.receita += item.receita;
      atual.custo += item.custo;
      atual.lucro += item.lucro;
      atual.quantidade += item.quantidade;
      produtoRanking.set(item.produtoid, atual);
    }

    const totals = detalhesFiltrados.reduce(
      (acc, item) => {
        for (const key of [
          "faturamento",
          "recebidoLiquido",
          "custoProdutos",
          "comissao",
          "taxas",
          "despesas",
          "lucroPrevisto",
          "lucroRealizado",
        ] as const) {
          acc[key] += item[key];
        }
        return acc;
      },
      {
        faturamento: 0,
        recebidoLiquido: 0,
        custoProdutos: 0,
        comissao: 0,
        taxas: 0,
        despesas: 0,
        lucroPrevisto: 0,
        lucroRealizado: 0,
      },
    );

    const aggregate = (key: "data" | "setor") =>
      Array.from(
        detalhesFiltrados
          .reduce((map, item) => {
            const name = item[key];
            const value = map.get(name) ?? {
              nome: name,
              faturamento: 0,
              recebidoLiquido: 0,
              custos: 0,
              lucroPrevisto: 0,
              lucroRealizado: 0,
            };
            value.faturamento += item.faturamento;
            value.recebidoLiquido += item.recebidoLiquido;
            value.custos += item.custoProdutos + item.comissao + item.taxas + item.despesas;
            value.lucroPrevisto += item.lucroPrevisto;
            value.lucroRealizado += item.lucroRealizado;
            map.set(name, value);
            return map;
          }, new Map<string, any>())
          .values(),
      );

    const semRegistroInterno = (item: (typeof detalhesFiltrados)[number]) => {
      const resposta = { ...item };
      Reflect.deleteProperty(resposta, "registro");
      return resposta;
    };
    const ordensResposta = [...detalhesFiltrados]
      .sort((a, b) => b.lucroPrevisto - a.lucroPrevisto)
      .map(semRegistroInterno);
    const prejuizos = detalhesFiltrados
      .filter((item) => item.lucroPrevisto < 0)
      .sort((a, b) => a.lucroPrevisto - b.lucroPrevisto)
      .slice(0, 10)
      .map(semRegistroInterno);

    return NextResponse.json({
      filtros,
      setores,
      kpis: {
        ...totals,
        comissoes: totals.comissao,
        ordens: detalhesFiltrados.length,
        margemPrevista: totals.faturamento > 0 ? (totals.lucroPrevisto / totals.faturamento) * 100 : 0,
        margemRealizada:
          totals.recebidoLiquido > 0 ? (totals.lucroRealizado / totals.recebidoLiquido) * 100 : 0,
      },
      evolucao: aggregate("data")
        .map((item: any) => ({ ...item, data: item.nome }))
        .sort((a: any, b: any) => String(a.data).localeCompare(String(b.data))),
      composicao: [
        { nome: "Produtos", valor: totals.custoProdutos },
        { nome: "Comissões", valor: totals.comissao },
        { nome: "Taxas", valor: totals.taxas },
        { nome: "Despesas", valor: totals.despesas },
      ],
      setoresRentabilidade: aggregate("setor").sort((a: any, b: any) => b.lucroPrevisto - a.lucroPrevisto),
      produtos: Array.from(produtoRanking.values())
        .sort((a, b) => b.lucro - a.lucro)
        .slice(0, 10),
      ordens: ordensResposta,
      prejuizos,
      qualidade: { estimados, semCusto, itensAvaliados },
    });
  } catch (error: any) {
    console.error("GET /api/dashboard/rentabilidade", error);
    return NextResponse.json({ error: error?.message || "Falha ao calcular rendimentos." }, { status: 500 });
  }
}
