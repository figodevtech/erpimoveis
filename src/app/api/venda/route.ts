// src/app/api/venda/route.ts

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { auth } from "@/lib/auth";
import { requireVendasAccess, requireVendasCreate } from "@/app/api/_authz/perms";

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
  subTotal: number;
  valorTotal: number;
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
  subTotal: number;
  valorTotal: number;
  dataVenda?: string | null; // opcional, ISO string. Se não vier, usa default do banco (now()).
  itens: VendaItemInput[];
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
  observacoes,
  observacoes_fiscais,
  forma_pagamento,
  sub_total,
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

      return NextResponse.json({ data });
    }

    // Lista paginada de vendas com filtros opcionais
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseAdmin
      .from("venda")
      .select(VENDA_SELECT, { count: "exact" })
      .order("id", { ascending: false })
      .range(from, to);

    let clienteIdNum: number | null = null;

    if (q) {
      query = query.or(`id.ilike.%${q}%,valortotal.ilike.%${q}%`);
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

    console.log("Criando venda com body:", body);
    // Validação básica no backend
    if (
      !body ||
      typeof body !== "object" ||
      !body.clienteId ||
      !body.created_by ||
      !body.status ||
      body.subTotal == null ||
      body.valorTotal == null ||
      !Array.isArray(body.itens) ||
      body.itens.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "Campos obrigatórios: clienteId, created_by, status, subTotal, valorTotal, itens[].",
        },
        { status: 400 }
      );
    }

    // Cada item precisa ter produtoId e quantidade > 0
    for (const item of body.itens) {
      if (!item.produtoId || !item.quantidade || item.quantidade <= 0) {
        return NextResponse.json(
          {
            error: "Cada item deve possuir produtoId e quantidade > 0.",
          },
          { status: 400 }
        );
      }
    }

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

    return NextResponse.json(
      {
        message: "Venda criada com sucesso.",
        data: vendaCompleta,
        id: vendaCompleta.id,
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
