// src/app/api/venda/route.ts

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createApiTiming } from "@/lib/api-timing";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { planoBuscaVendas } from "@/lib/vendas/busca";
import { auth } from "@/lib/auth";
import { requireVendasAccess, requireVendasCreate } from "@/app/api/_authz/perms";
import { carregarAutores } from "@/lib/movement-authors";
import { syncPendingMercadoLivreStock } from "@/lib/integrations/mercadolivre-stock-sync";
import { buscarModoBaixaEstoqueOS } from "@/lib/ordens/estoque-os";
import { normalizarDadosParaFinanceiro } from "@/lib/financeiro/dados-para-financeiro";
import type { PlannedPayment } from "@/lib/payment-methods";
import { applyMarketplaceBuyerNames } from "@/lib/vendas/marketplace-buyer-names";

type Status =
  | "ORCAMENTO"
  | "APROVACAO_ORCAMENTO"
  | "ORCAMENTO_APROVADO"
  | "ORCAMENTO_RECUSADO"
  | "ABERTA"
  | "PAGAMENTO"
  | "PENDENTE"
  | "PAGO"
  | "AUTORIZADO"
  | "FINALIZADA"
  | "CANCELADA"
  | "CANCELADO";
/** Canais reais de venda: PDV (balcão), Online (site próprio) e marketplaces. */
const CANAIS = new Set(["PDV", "ONLINE", "MERCADO_LIVRE", "SHOPEE"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_SET = new Set<Status>([
  "ORCAMENTO",
  "APROVACAO_ORCAMENTO",
  "ORCAMENTO_APROVADO",
  "ORCAMENTO_RECUSADO",
  "ABERTA",
  "PAGAMENTO",
  "PENDENTE",
  "PAGO",
  "AUTORIZADO",
  "FINALIZADA",
  "CANCELADA",
  "CANCELADO",
]);

type VendaItemInput = {
  produtoId: number;
  quantidade: number;
  precoUnitario?: number;
  subTotal?: number;
  valorTotal?: number;
  valorDesconto?: number | null;
  tipoDesconto?: string | null;
  valorFrete?: number | null;
};

type VendaPostBody = {
  clienteId: number;
  created_by: string; // uuid
  vendedor: string; // uuid
  status: string; // enum_status_venda, ex: 'ABERTA', 'FINALIZADA', etc.
  formaPagamento?: string | null;
  /** O que a venda manda ao financeiro; ver lib/financeiro/dados-para-financeiro. */
  pagamentosPrevistos?: PlannedPayment[] | null;
  descricaoFinanceiro?: string | null;
  garantia?: string | null;
  descricao?: string | null;
  observacoes?: string | null;
  observacoesFiscais?: string | null;
  /** Preenchido no servidor a partir de pagamentosPrevistos. */
  parcelasPagamento?: number | null;
  descontoTipo?: string | null; // enum_tipo_desconto_venda
  descontoValor?: number | null;
  categoriaVendaId?: number | null;
  subTotal?: number;
  valorFrete?: number;
  valorTotal?: number;
  dataVenda?: string | null; // opcional, ISO string. Se não vier, usa default do banco (now()).
  itens: VendaItemInput[];
  baixarEstoque?: boolean;
};

const VENDA_SELECT = `
  id,
  clienteid,
  cliente:cliente (
  id, nomerazaosocial, cpfcnpj, telefone, email ),
  status,
  statusaprovacao,
  categoriavendaid,
  categoria_venda:categoriavendaid (
    id,
    nome,
    descricao,
    ativo
  ),
  valortotal,
  datavenda,
  createdat,
  updatedat,
  created_by,
  vendedor,
  updated_by,
  motivo_cancelamento,
  cancelada_at,
  cancelada_by,
  cancelada_por:cancelada_by ( id, nome ),
  criador:created_by ( id, nome ),
  vendedor_rel:vendedor ( id, nome ),
  editor:updated_by ( id, nome ),
  canal,
  status_entrega,
  codigo_rastreio,
  transportadora_rastreio,
  ultimo_evento_rastreio,
  ultimo_evento_rastreio_em,
  status_rastreio,
  eventos_rastreio,
  rastreio_atualizado_em,
  nfe_chave_acesso,
  danfe_url,
  desconto_tipo,
  desconto_valor,
  valor_frete,
  acrescimo_financeiro_tipo,
  acrescimo_financeiro_valor,
  descricao,
  observacoes,
  observacoes_fiscais,
  forma_pagamento,
  pagamentos_previstos,
  parcelas_pagamento,
  descricao_financeiro,
  garantia,
  sub_total,
  transacoes:transacao!transacao_vendaid_fkey (
    id,
    valor,
    valorLiquido,
    data,
    tipo,
    pendente,
    is_deleted,
    evento_financeiro_id,
    baixado_por
  ),
  itens:vendaproduto (
    id,
    produtoid,
    quantidade,
    sub_total,
    valor_total,
    valor_desconto,
    tipo_desconto,
    valor_frete,
    produto:produtoid (
      id,
      titulo,
      precovenda
    )
  )
`;

// Exclusivo da tabela do historico; detalhes e demais consumidores mantem
// o contrato completo. Nao remove joins auxiliares exigidos pelos filtros.
const VENDA_LIST_SELECT = `
  id, clienteid, cliente:cliente (id, nomerazaosocial, telefone),
  status, valortotal, datavenda, canal, status_entrega
`;

/* ========================= GET ========================= */
/**
 * GET /api/venda
 *  - ?id=123                 : retorna uma venda específica com itens + produto
 *  - Sem id: lista paginada com filtros opcionais
 *      - page (padrão 1)
 *      - limit ou pageSize (padrão 20, máx 100)
 *      - clienteId
 *      - status
 */
export async function GET(req: Request) {
  const timing = createApiTiming();
  try {
    await timing.measure("access", () => requireVendasAccess());
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const resumida = searchParams.get("view") === "historico";
    const clienteId = searchParams.get("clienteId");
    const cliente = searchParams.get("cliente")?.trim() || "";
    const notaNumero = searchParams.get("notaNumero")?.trim() || "";
    const dateFrom = searchParams.get("dateFrom")?.trim() || "";
    const dateTo = searchParams.get("dateTo")?.trim() || "";
    const apenasMinhas = ["1", "true", "yes"].includes(
      (searchParams.get("apenasMinhas") ?? "").trim().toLowerCase()
    );
    const canalParam = (searchParams.get("canal") ?? "").trim().toUpperCase();
    const canal = CANAIS.has(canalParam) ? canalParam : "";
    const categoriaVendaIdParam = Number(searchParams.get("categoriaVendaId"));
    const categoriaVendaId =
      Number.isInteger(categoriaVendaIdParam) && categoriaVendaIdParam > 0 ? categoriaVendaIdParam : null;
    const vendedorIdParam = (searchParams.get("vendedorId") ?? "").trim();
    const vendedorId = UUID.test(vendedorIdParam) ? vendedorIdParam : "";
    // Faixa de valor: "vendas grandes primeiro" ou "só as pequenas que travaram
    // no pagamento" são pergunta de valor, não de status.
    // `!valor` descarta ausente e vazio antes do Number() — sem isso,
    // `Number("")` vale 0, e "sem máximo" vira "valor até zero": toda venda de
    // verdade some da lista.
    const valorMinRaw = searchParams.get("valorMin");
    const valorMin = valorMinRaw && Number.isFinite(Number(valorMinRaw)) && Number(valorMinRaw) >= 0
      ? Number(valorMinRaw)
      : null;
    const valorMaxRaw = searchParams.get("valorMax");
    const valorMax = valorMaxRaw && Number.isFinite(Number(valorMaxRaw)) && Number(valorMaxRaw) >= 0
      ? Number(valorMaxRaw)
      : null;

    const statusParam = (searchParams.get("status") ?? "TODOS").toUpperCase();
    const statusFilter = STATUS_SET.has(statusParam as Status)
      ? (statusParam as Status)
      : null;
    if (valorMin !== null && valorMax !== null && valorMin > valorMax) {
      return timing.json({ error: "O valor mínimo não pode superar o máximo." }, { status: 400 });
    }
    const dataValida = (data: string) => /^\d{4}-\d{2}-\d{2}$/.test(data) && Number.isFinite(Date.parse(data)) && new Date(data).toISOString().slice(0, 10) === data;
    if ((dateFrom && !dataValida(dateFrom)) || (dateTo && !dataValida(dateTo)) || (dateFrom && dateTo && dateFrom > dateTo)) {
      return timing.json({ error: "Informe um período válido, com início anterior ao fim." }, { status: 400 });
    }
    // Paginação (para lista)
    const pageValue = Number(searchParams.get("page") ?? 1);
    const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
    const q = (
      searchParams.get("search") ??
      searchParams.get("q") ??
      ""
    ).trim();
    if ([q, cliente, notaNumero].some((termo) => termo.length > 200)) {
      return timing.json({ error: "Use até 200 caracteres em cada campo de busca." }, { status: 400 });
    }

    const limitRaw =
      searchParams.get("limit") ?? searchParams.get("pageSize") ?? "20";
    const limitValue = Number(limitRaw);
    const limit = Number.isSafeInteger(limitValue) && limitValue > 0 ? Math.min(limitValue, 100) : 20;

    const emptyResponse = () =>
      timing.json({
        data: [],
        pagination: {
          total: 0,
          page,
          limit,
          totalPages: 1,
          pageCount: 0,
          hasPrevPage: false,
          hasNextPage: false,
        },
        filters: {
          search: q,
          clienteId: null,
          status: statusFilter ?? null,
        },
      });

    // Se veio id, retorna somente uma venda específica (sem paginação)
    if (id) {
      const vendaId = Number(id);
      if (Number.isNaN(vendaId)) {
        return timing.json(
          { error: 'Parâmetro "id" inválido.' },
          { status: 400 }
        );
      }

      const { data, error } = await supabaseAdmin
        .from("venda")
        .select(VENDA_SELECT)
        .eq("id", vendaId)
        .single();

      if (error) {
        console.error("Erro ao buscar venda por id:", error);
        return timing.json(
          { error: "Erro ao buscar venda." },
          { status: 500 }
        );
      }

      if (!data) {
        return timing.json(
          { error: "Venda não encontrada." },
          { status: 404 }
        );
      }

      const [item] = await applyMarketplaceBuyerNames([data]);
      return timing.json({ data: item });
    }

    // Lista paginada de vendas com filtros opcionais
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const plano = planoBuscaVendas(q, cliente, notaNumero);
    // O PostgREST devolve a consulta em Content-Location. Limita o tamanho
    // antes de exceder o limite de cabeçalhos HTTP do transporte.
    if (encodeURIComponent(JSON.stringify(plano)).length > 10000) {
      return timing.json({ error: "Busca muito longa. Use um trecho do nome, documento ou descrição." }, { status: 400 });
    }
    let query = supabaseAdmin
      .from("venda")
      .select([resumida ? VENDA_LIST_SELECT : VENDA_SELECT, ...plano.select].join(","), { count: "exact" })
      .order("id", { ascending: false })
      .range(from, to);

    // "Minhas vendas": o dono vem da sessao, nunca de um id enviado pelo cliente.
    if (apenasMinhas) {
      const session = await auth();
      const usuarioId = (session?.user as any)?.id as string | undefined;
      if (!usuarioId) return emptyResponse();
      query = query.eq("created_by", usuarioId);
    }

    let clienteIdNum: number | null = null;

    for (const filtro of plano.filtros) {
      query = query.or(filtro.expressao, { referencedTable: filtro.relacao });
    }
    if (plano.or.length) query = query.or(plano.or.join(","));
    for (const obrigatoria of plano.obrigatorias) query = query.or(obrigatoria);

    if (dateFrom) {
      query = query.gte("datavenda", `${dateFrom}T00:00:00.000-03:00`);
    }

    if (dateTo) {
      query = query.lte("datavenda", `${dateTo}T23:59:59.999-03:00`);
    }

    if (clienteId) {
      clienteIdNum = Number(clienteId);
      if (Number.isNaN(clienteIdNum)) {
        return timing.json(
          { error: 'Parâmetro "clienteId" inválido.' },
          { status: 400 }
        );
      }
      query = query.eq("clienteid", clienteIdNum);
    }

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const entrega = searchParams.get("statusEntrega");
    if (entrega === "NAO_INICIADA") query = query.is("status_entrega", null).in("canal", ["ONLINE", "MERCADO_LIVRE", "SHOPEE"]);
    else if (["SEPARACAO", "ENVIO", "ENTREGUE"].includes(entrega ?? "")) query = query.eq("status_entrega", entrega!);

    if (canal) query = query.eq("canal", canal);
    if (categoriaVendaId) query = query.eq("categoriavendaid", categoriaVendaId);
    if (vendedorId) query = query.eq("vendedor", vendedorId);
    if (valorMin != null) query = query.gte("valortotal", valorMin);
    if (valorMax != null) query = query.lte("valortotal", valorMax);

    const { data, error, count } = await timing.measure("query", () => query);

    if (error) {
      console.error("Erro ao listar vendas:", error);
      return timing.json(
        { error: "Erro ao listar vendas." },
        { status: 500 }
      );
    }

    const items = (data ?? []) as any[];
    // Relações auxiliares de busca não fazem parte da resposta da listagem.
    for (const item of items) {
      for (const key of Object.keys(item)) {
        if (key.startsWith("busca_") || key.startsWith("filtro_")) delete item[key];
      }
    }

    if (resumida) {
      await timing.measure("marketplace", () => applyMarketplaceBuyerNames(items));
      const total = count ?? 0;
      return timing.json({
        data: items,
        pagination: {
          total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)),
          pageCount: items.length, hasPrevPage: page > 1, hasNextPage: page * limit < total,
        },
        filters: { search: q, clienteId: clienteIdNum, status: statusFilter ?? null },
      });
    }

    // `transacao.baixado_por` e um uuid solto (sem FK para `usuario`), entao o nome
    // de quem executou a baixa e resolvido em lote.
    const vendaIds = items.map((item: any) => Number(item.id)).filter(Number.isFinite);
    // Os enriquecimentos usam apenas os ids da pagina, sem depender uns dos
    // outros. Mantem consultas e regras, mas evita somar suas latencias de rede.
    const [autores, rateioResult, notasResult, vinculosResult] = await Promise.all([
      carregarAutores(items.flatMap((item: any) => (item.transacoes ?? []).map((t: any) => t.baixado_por))),
      vendaIds.length > 0
        ? supabaseAdmin.from("pagamento_multiplo_rateio")
          .select("documento_id, valor, transacao:transacao_id ( id, data, pendente, is_deleted )")
          .eq("tipo_documento", "VENDA").in("documento_id", vendaIds)
        : Promise.resolve({ data: [], error: null }),
      vendaIds.length > 0
        ? supabaseAdmin.from("nfe").select("vendaid, numero, createdat")
          .in("vendaid", vendaIds).not("vendaid", "is", null).order("numero", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      vendaIds.length > 0
        ? supabaseAdmin.from("nfe_origem_vinculo").select("origem_id, nfe_id")
          .eq("tipo", "VENDA").in("origem_id", vendaIds)
        : Promise.resolve({ data: [], error: null }),
      applyMarketplaceBuyerNames(items),
    ]);
    for (const item of items as any[]) {
      for (const transacao of item.transacoes ?? []) {
        transacao.baixadoPor = autores.get(String(transacao.baixado_por ?? "")) ?? null;
      }
    }

    // Pagamento múltiplo não preenche `vendaid` — a transação cobre várias
    // vendas e o elo é o rateio. Sem juntar essas fatias aqui, a venda paga em
    // grupo aparece em aberto na listagem e pode ser cobrada de novo.
    if (vendaIds.length > 0) {
      const { data: rateio, error: rateioError } = rateioResult;
      if (rateioError) throw rateioError;

      const fatiasPorVenda = new Map<number, any[]>();
      for (const linha of (rateio ?? []) as any[]) {
        const transacao = linha.transacao;
        if (!transacao || transacao.is_deleted) continue;

        const vendaId = Number(linha.documento_id);
        const lista = fatiasPorVenda.get(vendaId) ?? [];
        lista.push({
          id: transacao.id,
          valor: Number(linha.valor ?? 0),
          valorLiquido: Number(linha.valor ?? 0),
          data: transacao.data,
          tipo: "RECEITA",
          pendente: transacao.pendente === true,
          is_deleted: false,
          evento_financeiro_id: null,
          baixado_por: null,
          baixadoPor: null,
          rateado: true,
        });
        fatiasPorVenda.set(vendaId, lista);
      }

      for (const item of items as any[]) {
        const fatias = fatiasPorVenda.get(Number(item.id));
        if (fatias?.length) item.transacoes = [...(item.transacoes ?? []), ...fatias];
      }
    }

    if (vendaIds.length > 0) {
      /*
       * Duas consultas, porque uma nota consolidada cobre várias vendas e só a
       * âncora aparece em `nfe.vendaid`. Sem o vínculo, uma venda já faturada
       * por nota agrupada mostraria a coluna "Nota" vazia e voltaria a ser
       * oferecida para emissão.
       */
      const { data: notasData, error: notasError } = notasResult;
      const { data: vinculosData, error: vinculosError } = vinculosResult;

      if (notasError) {
        throw notasError;
      }
      // O vínculo é enriquecimento, não requisito: sem a migration aplicada,
      // a listagem continua com o que a coluna escalar sabe.
      if (vinculosError) {
        console.warn("[GET /api/venda] vínculo de origem indisponível:", vinculosError.message);
      }

      const notaPorVenda = new Map<number, number>();

      for (const nota of notasData ?? []) {
        const vendaId = Number((nota as any).vendaid);
        const numero = Number((nota as any).numero);

        if (!Number.isFinite(vendaId) || !Number.isFinite(numero)) continue;
        if (notaPorVenda.has(vendaId)) continue;

        notaPorVenda.set(vendaId, numero);
      }

      // A âncora já entrou acima; aqui entram as vendas agregadas.
      const idsDeNotasVinculadas = [
        ...new Set((vinculosData ?? []).map((linha: any) => Number(linha.nfe_id))),
      ].filter((id) => Number.isFinite(id));

      if (idsDeNotasVinculadas.length > 0) {
        const { data: numerosData, error: numerosError } = await supabaseAdmin
          .from("nfe")
          .select("id, numero")
          .in("id", idsDeNotasVinculadas);

        if (numerosError) {
          throw numerosError;
        }

        const numeroPorNota = new Map<number, number>(
          (numerosData ?? []).map((linha: any) => [Number(linha.id), Number(linha.numero)]),
        );

        for (const vinculo of vinculosData ?? []) {
          const vendaId = Number((vinculo as any).origem_id);
          const numero = numeroPorNota.get(Number((vinculo as any).nfe_id));

          if (!Number.isFinite(vendaId) || !Number.isFinite(numero as number)) continue;
          if (notaPorVenda.has(vendaId)) continue;

          notaPorVenda.set(vendaId, numero as number);
        }
      }

      items.forEach((item: any) => {
        item.notaNumero = notaPorVenda.get(Number(item.id)) ?? null;
      });
    }

    const total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const pageCount = items.length;
    const hasPrevPage = page > 1;
    const hasNextPage = page * limit < total;

    return timing.json({
      data: items,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        pageCount,
        hasPrevPage,
        hasNextPage,
      },
      filters: {
        search: q,
        clienteId: clienteIdNum,
        status: statusFilter ?? null,
      },
    });
  } catch (e: any) {
    console.error("Erro inesperado no GET /venda:", e);
    return timing.json(
      { error: e?.message || "Erro interno do servidor." },
      { status: 500 }
    );
  }
}

/* ========================= POST ========================= */
/**
 * POST /api/venda
 * Body no formato de VendaPostBody.
 * Usa RPC fn_criar_venda_com_itens (transacional no banco).
 */
export async function POST(req: Request) {
  try {
    await requireVendasCreate();
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Usuário não autenticado." }, { status: 401 });
    }

    const body = (await req.json()) as VendaPostBody;

    body.created_by = session.user.id;
    if (!body.vendedor) {
      body.vendedor = session.user.id;
    }

    // Validação básica no backend
    if (
      !body ||
      typeof body !== "object" ||
      !body.clienteId ||
      !body.created_by ||
      !body.status ||
      !Array.isArray(body.itens) ||
      body.itens.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "Campos obrigatórios: clienteId, created_by, status, itens[].",
        },
        { status: 400 }
      );
    }

    body.status = String(body.status).toUpperCase();
    if (!(["ORCAMENTO", "PAGAMENTO"] as string[]).includes(body.status)) {
      return NextResponse.json(
        { error: "Uma nova venda deve ser criada como orçamento ou em pagamento." },
        { status: 400 },
      );
    }

    // Cada item precisa ter produtoId e quantidade > 0
    for (const item of body.itens) {
      if (
        !Number.isInteger(Number(item.produtoId)) ||
        !Number.isInteger(Number(item.quantidade)) ||
        Number(item.quantidade) <= 0
      ) {
        return NextResponse.json(
          {
            error: "Cada item deve possuir produtoId e quantidade > 0.",
          },
          { status: 400 }
        );
      }
    }

    // Nunca confie em preços ou totais enviados pelo navegador. Além de evitar
    // manipulação da requisição, isto mantém venda e itens contabilmente coerentes.
    const quantitiesByProduct = new Map<number, number>();
    const requestedPriceByProduct = new Map<number, number>();
    for (const item of body.itens) {
      const productId = Number(item.produtoId);
      const hasRequestedPrice = item.precoUnitario !== undefined && item.precoUnitario !== null;
      if (hasRequestedPrice) {
        const requestedPrice = Number(item.precoUnitario);
        if (!Number.isFinite(requestedPrice) || requestedPrice <= 0) {
          return NextResponse.json(
            { error: `Informe um preço unitário maior que zero para o produto ${productId}.` },
            { status: 400 },
          );
        }
        const previousPrice = requestedPriceByProduct.get(productId);
        if (previousPrice !== undefined && Math.abs(previousPrice - requestedPrice) > 0.001) {
          return NextResponse.json(
            { error: `O produto ${productId} foi informado com preços unitários diferentes.` },
            { status: 400 },
          );
        }
        requestedPriceByProduct.set(productId, requestedPrice);
      }
      quantitiesByProduct.set(
        productId,
        (quantitiesByProduct.get(productId) ?? 0) + Number(item.quantidade),
      );
    }

    const requestedProductIds = Array.from(quantitiesByProduct.keys());
    const { data: products, error: productsError } = await supabaseAdmin
      .from("produto")
      .select("id, precovenda")
      .in("id", requestedProductIds);

    if (productsError) throw productsError;

    const priceByProduct = new Map(
      (products ?? []).map((product) => [
        Number(product.id),
        Number(product.precovenda),
      ]),
    );
    const unavailableIds = requestedProductIds.filter((id) => !priceByProduct.has(id));

    if (unavailableIds.length > 0) {
      return NextResponse.json(
        { error: "Um ou mais produtos não existem." },
        { status: 400 },
      );
    }

    const invalidPriceIds = requestedProductIds.filter((id) => {
      const price = requestedPriceByProduct.get(id) ?? priceByProduct.get(id);
      return price === undefined || !Number.isFinite(price) || price <= 0;
    });
    if (invalidPriceIds.length > 0) {
      return NextResponse.json(
        { error: "Informe um preço de venda maior que zero para todos os produtos." },
        { status: 400 },
      );
    }

    const roundMoney = (value: number) => Math.round(value * 100) / 100;
    const normalizedItems: VendaItemInput[] = requestedProductIds.map((productId) => {
      const quantity = quantitiesByProduct.get(productId)!;
      const unitPrice = requestedPriceByProduct.get(productId) ?? priceByProduct.get(productId)!;
      const itemTotal = roundMoney(unitPrice * quantity);
      return {
        produtoId: productId,
        quantidade: quantity,
        precoUnitario: roundMoney(unitPrice),
        subTotal: itemTotal,
        valorTotal: itemTotal,
        valorDesconto: 0,
        tipoDesconto: null,
        valorFrete: 0,
      };
    });
    const serverSubTotal = roundMoney(
      normalizedItems.reduce((sum, item) => sum + (item.subTotal ?? 0), 0),
    );
    const requestedDiscount = Number(body.descontoValor ?? 0);
    const serverDiscount = roundMoney(
      Math.min(
        serverSubTotal,
        Number.isFinite(requestedDiscount) ? Math.max(0, requestedDiscount) : 0,
      ),
    );
    const requestedFreight = Number(body.valorFrete ?? 0);
    if (!Number.isFinite(requestedFreight) || requestedFreight < 0) {
      return NextResponse.json(
        { error: "O valor do frete deve ser maior ou igual a zero." },
        { status: 400 },
      );
    }
    const serverFreight = roundMoney(requestedFreight);

    body.itens = normalizedItems;
    body.subTotal = serverSubTotal;
    body.descontoValor = serverDiscount > 0 ? serverDiscount : null;
    body.valorFrete = serverFreight;
    body.valorTotal = roundMoney(serverSubTotal - serverDiscount + serverFreight);
    const modoBaixa = await buscarModoBaixaEstoqueOS();
    body.baixarEstoque = body.status !== "ORCAMENTO" || modoBaixa === "ORCAMENTO";

    const categoriaVendaId =
      body.categoriaVendaId === null || body.categoriaVendaId === undefined
        ? null
        : Number(body.categoriaVendaId);
    if (categoriaVendaId !== null && (!Number.isFinite(categoriaVendaId) || categoriaVendaId <= 0)) {
      return NextResponse.json({ error: "categoriaVendaId inválido." }, { status: 400 });
    }
    body.categoriaVendaId = categoriaVendaId;

    const dadosFinanceiro = await normalizarDadosParaFinanceiro(
      body,
      Math.round(Number(body.valorTotal) * 100),
    );
    if ("erro" in dadosFinanceiro) {
      return NextResponse.json({ error: dadosFinanceiro.erro }, { status: 400 });
    }
    if ("pagamentos_previstos" in dadosFinanceiro.colunas) {
      body.pagamentosPrevistos = dadosFinanceiro.colunas.pagamentos_previstos ?? null;
    }
    if ("descricao_financeiro" in dadosFinanceiro.colunas) {
      body.descricaoFinanceiro = dadosFinanceiro.colunas.descricao_financeiro ?? null;
    }
    if ("garantia" in dadosFinanceiro.colunas) {
      body.garantia = dadosFinanceiro.colunas.garantia ?? null;
    }
    if ("parcelas_pagamento" in dadosFinanceiro.colunas) {
      body.parcelasPagamento = dadosFinanceiro.colunas.parcelas_pagamento ?? null;
    }
    body.descricao = String(body.descricao ?? "").trim() || null;
    body.observacoes = String(body.observacoes ?? "").trim() || null;
    body.observacoesFiscais = String(body.observacoesFiscais ?? "").trim() || null;

    // Chama função RPC no Postgres (tudo transacional lá)
    const { data: vendaId, error: rpcError } = await supabaseAdmin.rpc(
      "fn_criar_venda_com_itens",
      {
        p_venda: body as any, // supabase converte objeto JS -> jsonb
      }
    );

    if (rpcError) {
      console.error("Erro na fn_criar_venda_com_itens:", rpcError);
      const msg = (rpcError as any).message ?? "Erro ao criar venda.";
      const isBadReq =
        msg.toLowerCase().includes("obrigatório") ||
        msg.toLowerCase().includes("estoque") ||
        msg.toLowerCase().includes("ausentes");
      return NextResponse.json(
        { error: msg },
        { status: isBadReq ? 400 : 500 }
      );
    }

    if (!vendaId) {
      return NextResponse.json(
        { error: "Função fn_criar_venda_com_itens não retornou id da venda." },
        { status: 500 }
      );
    }

    const { data: vendaCanalRow, error: vendaCanalError } = await supabaseAdmin
      .from("venda")
      .select("id, canal")
      .eq("id", vendaId)
      .single();

    if (vendaCanalError) {
      console.error("Venda criada, mas erro ao verificar canal da venda:", vendaCanalError);
      return NextResponse.json(
        {
          error: "Venda criada, mas ocorreu um erro ao validar os campos de entrega.",
          vendaId,
        },
        { status: 500 }
      );
    }

    if (!isMarketplaceCanal((vendaCanalRow as any)?.canal)) {
      const { error: sanitizeEntregaError } = await supabaseAdmin
        .from("venda")
        .update({
          status_entrega: null,
          codigo_rastreio: null,
          transportadora_rastreio: null,
          ultimo_evento_rastreio: null,
          ultimo_evento_rastreio_em: null,
          status_rastreio: null,
          eventos_rastreio: null,
          rastreio_atualizado_em: null,
          updatedat: new Date().toISOString(),
        })
        .eq("id", vendaId);

      if (sanitizeEntregaError) {
        console.error(
          "Venda criada, mas erro ao limpar campos de entrega para venda não ONLINE:",
          sanitizeEntregaError
        );
        return NextResponse.json(
          {
            error: "Venda criada, mas ocorreu um erro ao limpar os campos de entrega.",
            vendaId,
          },
          { status: 500 }
        );
      }
    }

    // Busca a venda completa (com itens + produto)
    const { data: vendaCompleta, error: vendaError } = await supabaseAdmin
      .from("venda")
      .select(VENDA_SELECT)
      .eq("id", vendaId)
      .single();

    if (vendaError) {
      console.error("Venda criada, mas erro ao carregar detalhes:", vendaError);
      return NextResponse.json(
        {
          message:
            "Venda criada, mas ocorreu um erro ao carregar os detalhes da venda.",
          vendaId,
        },
        { status: 201 }
      );
    }

    const productIds = body.itens
      .map((item: any) => Number(item?.produtoId))
      .filter((id: number) => Number.isInteger(id) && id > 0);
    const marketplaceStockSync = await syncPendingMercadoLivreStock({ productIds, limit: productIds.length || 1 }).catch((error: any) => {
      console.warn("Venda criada; sincronização imediata do estoque Mercado Livre ficou pendente.", error);
      return [];
    });

    return NextResponse.json(
      {
        message: "Venda criada com sucesso.",
        data: vendaCompleta,
        id: vendaCompleta.id,
        marketplaceStockSync,
      },
      { status: 201 }
    );
  } catch (e: any) {
    console.error("Erro inesperado no POST /venda:", e);
    const msg =
      e?.message ??
      "Erro ao criar venda. Verifique os campos obrigatórios e os tipos.";
    const isBadReq =
      msg.toLowerCase().includes("obrigatório") ||
      msg.toLowerCase().includes("ausentes");
    return NextResponse.json({ error: msg }, { status: isBadReq ? 400 : 500 });
  }
}

function isMarketplaceCanal(canal: unknown) {
  const value = String(canal ?? "").toUpperCase();
  return value === "ONLINE" || value === "MERCADO_LIVRE" || value === "SHOPEE";
}
