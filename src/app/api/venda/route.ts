// src/app/api/venda/route.ts

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { auth } from "@/lib/auth";
import { requireVendasAccess, requireVendasCreate } from "@/app/api/_authz/perms";
import { carregarAutores } from "@/lib/movement-authors";
import { syncPendingMercadoLivreStock } from "@/lib/integrations/mercadolivre-stock-sync";
import { buscarModoBaixaEstoqueOS } from "@/lib/ordens/estoque-os";

type Status =
  | "ORCAMENTO"
  | "ABERTA"
  | "PAGAMENTO"
  | "PENDENTE"
  | "PAGO"
  | "AUTORIZADO"
  | "FINALIZADA"
  | "CANCELADA"
  | "CANCELADO";
const STATUS_SET = new Set<Status>([
  "ORCAMENTO",
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
};

type VendaPostBody = {
  clienteId: number;
  created_by: string; // uuid
  vendedor: string; // uuid
  status: string; // enum_status_venda, ex: 'ABERTA', 'FINALIZADA', etc.
  formaPagamento?: string | null;
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
  id, nomerazaosocial ),
  status,
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
  observacoes,
  observacoes_fiscais,
  forma_pagamento,
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
    produto:produtoid (
      id,
      titulo,
      precovenda
    )
  )
`;

async function applyMarketplaceBuyerNames(vendas: any[]) {
  const vendaIds = vendas
    .filter((venda) => String(venda?.canal ?? "").toUpperCase() === "MERCADO_LIVRE")
    .map((venda) => Number(venda.id))
    .filter(Number.isFinite);

  if (vendaIds.length === 0) return vendas;

  const { data, error } = await supabaseAdmin
    .from("mercadolivre_order")
    .select("venda_id, buyer_id, raw_order")
    .in("venda_id", vendaIds);

  if (error) throw error;

  const buyerNameByVenda = new Map<number, string>();
  for (const order of data ?? []) {
    const vendaId = Number((order as any).venda_id);
    const buyerName = formatMercadoLivreBuyerName((order as any).raw_order, (order as any).buyer_id);
    if (Number.isFinite(vendaId) && buyerName) buyerNameByVenda.set(vendaId, buyerName);
  }

  for (const venda of vendas) {
    const buyerName = buyerNameByVenda.get(Number(venda.id));
    if (!buyerName) continue;
    venda.cliente = {
      ...(venda.cliente ?? {}),
      nomerazaosocial: buyerName,
    };
  }

  return vendas;
}

function formatMercadoLivreBuyerName(rawOrder: any, buyerId?: number | null) {
  const buyer = rawOrder?.buyer ?? {};
  const fullName = [buyer.first_name, buyer.last_name].map((value) => String(value ?? "").trim()).filter(Boolean).join(" ");
  if (fullName) return fullName;
  if (buyer.nickname) return String(buyer.nickname).trim();
  const id = buyer.id ?? buyerId;
  return id ? `Comprador Mercado Livre #${id}` : "";
}

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
  try {
    await requireVendasAccess();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const clienteId = searchParams.get("clienteId");
    const cliente = searchParams.get("cliente")?.trim() || "";
    const notaNumero = searchParams.get("notaNumero")?.trim() || "";
    const dateFrom = searchParams.get("dateFrom")?.trim() || "";
    const dateTo = searchParams.get("dateTo")?.trim() || "";
    const apenasMinhas = ["1", "true", "yes"].includes(
      (searchParams.get("apenasMinhas") ?? "").trim().toLowerCase()
    );

    const statusParam = (searchParams.get("status") ?? "TODOS").toUpperCase();
    const statusFilter = STATUS_SET.has(statusParam as Status)
      ? (statusParam as Status)
      : null;
    // Paginação (para lista)
    const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
    const q = (
      searchParams.get("search") ??
      searchParams.get("q") ??
      ""
    ).trim();

    const limitRaw =
      searchParams.get("limit") ?? searchParams.get("pageSize") ?? "20";
    const limit = Math.min(Math.max(Number(limitRaw), 1), 100);

    const emptyResponse = () =>
      NextResponse.json({
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
        return NextResponse.json(
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
        return NextResponse.json(
          { error: "Erro ao buscar venda." },
          { status: 500 }
        );
      }

      if (!data) {
        return NextResponse.json(
          { error: "Venda não encontrada." },
          { status: 404 }
        );
      }

      const [item] = await applyMarketplaceBuyerNames([data]);
      return NextResponse.json({ data: item });
    }

    // Lista paginada de vendas com filtros opcionais
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseAdmin
      .from("venda")
      .select(VENDA_SELECT, { count: "exact" })
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

    if (q) {
      const orFilters: string[] = [];
      const safeText = q.replace(/[,%()]/g, " ").trim();

      if (safeText) {
        const { data: clientesBusca, error: clientesBuscaError } = await supabaseAdmin
          .from("cliente")
          .select("id")
          .or(
            `nomerazaosocial.ilike.%${safeText}%,cpfcnpj.ilike.%${safeText}%,telefone.ilike.%${safeText}%`
          )
          .limit(200);

        if (clientesBuscaError) throw clientesBuscaError;
        const clienteIdsBusca = (clientesBusca ?? [])
          .map((item) => Number(item.id))
          .filter(Number.isFinite);
        if (clienteIdsBusca.length > 0) {
          orFilters.push(`clienteid.in.(${clienteIdsBusca.join(",")})`);
        }
      }

      const digits = q.replace(/\D/g, "");
      if (digits) {
        const { data: notasBusca, error: notasBuscaError } = await supabaseAdmin
          .from("nfe")
          .select("vendaid")
          .eq("numero", Number(digits))
          .not("vendaid", "is", null)
          .limit(200);

        if (notasBuscaError) throw notasBuscaError;
        const vendaIdsNota = (notasBusca ?? [])
          .map((item) => Number(item.vendaid))
          .filter(Number.isFinite);
        if (vendaIdsNota.length > 0) {
          orFilters.push(`id.in.(${vendaIdsNota.join(",")})`);
        }
      }

      const normalizedMoney = q
        .replace(/[^\d,.-]/g, "")
        .replace(/\.(?=\d{3}(?:\D|$))/g, "")
        .replace(",", ".");
      const numericValue = Number(normalizedMoney);
      if (Number.isFinite(numericValue)) {
        orFilters.push(`valortotal.eq.${numericValue}`);
      }
      if (/^\d+$/.test(q)) {
        orFilters.push(`id.eq.${Number(q)}`);
      }

      if (orFilters.length === 0) return emptyResponse();
      query = query.or(orFilters.join(","));
    }

    if (dateFrom) {
      query = query.gte("datavenda", `${dateFrom}T00:00:00.000Z`);
    }

    if (dateTo) {
      query = query.lte("datavenda", `${dateTo}T23:59:59.999Z`);
    }

    if (clienteId) {
      clienteIdNum = Number(clienteId);
      if (Number.isNaN(clienteIdNum)) {
        return NextResponse.json(
          { error: 'Parâmetro "clienteId" inválido.' },
          { status: 400 }
        );
      }
      query = query.eq("clienteid", clienteIdNum);
    }

    if (cliente) {
      const { data: clientesData, error: clientesError } = await supabaseAdmin
        .from("cliente")
        .select("id")
        .or(
          `nomerazaosocial.ilike.%${cliente}%,cpfcnpj.ilike.%${cliente}%,telefone.ilike.%${cliente}%`
        )
        .limit(200);

      if (clientesError) {
        throw clientesError;
      }

      const clienteIds = (clientesData ?? []).map((item) => item.id);
      if (clienteIds.length === 0) {
        return emptyResponse();
      }

      query = query.in("clienteid", clienteIds);
    }

    if (notaNumero) {
      const notaNumeroValue = Number(notaNumero.replace(/\D/g, ""));

      if (!Number.isFinite(notaNumeroValue)) {
        return emptyResponse();
      }

      const { data: notasData, error: notasError } = await supabaseAdmin
        .from("nfe")
        .select("vendaid")
        .eq("numero", notaNumeroValue)
        .not("vendaid", "is", null)
        .limit(200);

      if (notasError) {
        throw notasError;
      }

      const vendaIds = (notasData ?? [])
        .map((item) => item.vendaid)
        .filter((value): value is number => Number.isFinite(Number(value)));

      if (vendaIds.length === 0) {
        return emptyResponse();
      }

      query = query.in("id", vendaIds);
    }

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error("Erro ao listar vendas:", error);
      return NextResponse.json(
        { error: "Erro ao listar vendas." },
        { status: 500 }
      );
    }

    const items = data ?? [];

    // `transacao.baixado_por` e um uuid solto (sem FK para `usuario`), entao o nome
    // de quem executou a baixa e resolvido em lote.
    const autores = await carregarAutores(
      items.flatMap((item: any) => (item.transacoes ?? []).map((t: any) => t.baixado_por)),
    );
    for (const item of items as any[]) {
      for (const transacao of item.transacoes ?? []) {
        transacao.baixadoPor = autores.get(String(transacao.baixado_por ?? "")) ?? null;
      }
    }

    const vendaIds = items.map((item: any) => Number(item.id)).filter(Number.isFinite);

    if (vendaIds.length > 0) {
      const { data: notasData, error: notasError } = await supabaseAdmin
        .from("nfe")
        .select("vendaid, numero, createdat")
        .in("vendaid", vendaIds)
        .not("vendaid", "is", null)
        .order("numero", { ascending: false });

      if (notasError) {
        throw notasError;
      }

      const notaPorVenda = new Map<number, number>();

      for (const nota of notasData ?? []) {
        const vendaId = Number((nota as any).vendaid);
        const numero = Number((nota as any).numero);

        if (!Number.isFinite(vendaId) || !Number.isFinite(numero)) continue;
        if (notaPorVenda.has(vendaId)) continue;

        notaPorVenda.set(vendaId, numero);
      }

      items.forEach((item: any) => {
        item.notaNumero = notaPorVenda.get(Number(item.id)) ?? null;
      });
    }

    await applyMarketplaceBuyerNames(items);

    const total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const pageCount = items.length;
    const hasPrevPage = page > 1;
    const hasNextPage = page * limit < total;

    return NextResponse.json({
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
    return NextResponse.json(
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

    if (!session?.user.id) {
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

    const categoriaVendaId =
      body.categoriaVendaId === null || body.categoriaVendaId === undefined
        ? null
        : Number(body.categoriaVendaId);

    if (categoriaVendaId !== null && (!Number.isFinite(categoriaVendaId) || categoriaVendaId <= 0)) {
      return NextResponse.json(
        { error: "categoriaVendaId inválido.", vendaId },
        { status: 400 }
      );
    }

    if (body.formaPagamento !== undefined) {
      const { error: formaPagamentoError } = await supabaseAdmin
        .from("venda")
        .update({
          forma_pagamento: body.formaPagamento || null,
          vendedor: session.user.id,
          categoriavendaid: categoriaVendaId,
          updatedat: new Date().toISOString(),
        })
        .eq("id", vendaId);

      if (formaPagamentoError) {
        console.error("Venda criada, mas erro ao salvar forma_pagamento:", formaPagamentoError);
        return NextResponse.json(
          {
            error: "Venda criada, mas ocorreu um erro ao salvar os dados do vendedor/forma de pagamento.",
            vendaId,
          },
          { status: 500 }
        );
      }
    } else {
      const { error: vendedorError } = await supabaseAdmin
        .from("venda")
        .update({
          vendedor: session.user.id,
          categoriavendaid: categoriaVendaId,
          updatedat: new Date().toISOString(),
        })
        .eq("id", vendaId);

      if (vendedorError) {
        console.error("Venda criada, mas erro ao salvar vendedor:", vendedorError);
        return NextResponse.json(
          {
            error: "Venda criada, mas ocorreu um erro ao salvar o vendedor.",
            vendaId,
          },
          { status: 500 }
        );
      }
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
