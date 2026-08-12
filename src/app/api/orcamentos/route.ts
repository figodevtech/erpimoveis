// src/app/api/orcamentos/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOrcamentosAccess, requireOrcamentosCreate } from "@/app/api/_authz/perms";
import { normalizarItens, OrcamentoInvalidoError } from "@/lib/orcamentos/itens";
import { gravarItensDoOrcamento } from "@/lib/orcamentos/persistencia";

const SITUACOES = ["ABERTO", "CONVERTIDO"] as const;
type Situacao = (typeof SITUACOES)[number];

const SELECT_LISTA = `
  id,
  status,
  descricao,
  observacoes,
  subtotal,
  desconto_tipo,
  desconto,
  valor_frete,
  total,
  created_at,
  updated_at,
  cliente:clienteid ( id, nomerazaosocial, cpfcnpj, telefone ),
  veiculo:veiculoid ( id, placa, modelo, marca ),
  criador:usuariocriadorid ( id, nome )
`;

/* =========================================================
 * GET — lista paginada + contadores das duas abas
 * ========================================================= */
export async function GET(req: NextRequest) {
  try {
    await requireOrcamentosAccess();

    const { searchParams } = new URL(req.url);
    const situacaoParam = (searchParams.get("situacao") ?? "").trim().toUpperCase();
    const situacao = SITUACOES.includes(situacaoParam as Situacao)
      ? (situacaoParam as Situacao)
      : null;
    const busca = searchParams.get("q")?.trim() || "";
    const clienteBusca = searchParams.get("cliente")?.trim() || "";
    const dateFrom = searchParams.get("dateFrom")?.trim() || "";
    const dateTo = searchParams.get("dateTo")?.trim() || "";

    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 10), 1), 200);
    const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Os contadores alimentam os dois badges do topo e precisam ignorar a
    // paginacao e o filtro de situacao — mas respeitar os demais filtros, senao
    // o numero no badge nao bate com o que a lista mostra.
    const contarPorSituacao = async (valor: Situacao) => {
      let query = supabaseAdmin
        .from("orcamento")
        .select("id", { count: "exact", head: true })
        .eq("is_deleted", false)
        .eq("status", valor);
      if (dateFrom) query = query.gte("created_at", dateFrom);
      if (dateTo) query = query.lte("created_at", dateTo);
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    };

    let clienteIds: number[] | null = null;
    if (clienteBusca) {
      const { data, error } = await supabaseAdmin
        .from("cliente")
        .select("id")
        .or(
          `nomerazaosocial.ilike.%${clienteBusca}%,cpfcnpj.ilike.%${clienteBusca}%,telefone.ilike.%${clienteBusca}%`,
        )
        .limit(200);
      if (error) throw error;
      clienteIds = (data ?? []).map((row) => Number(row.id));
      if (clienteIds.length === 0) {
        const [abertos, convertidos] = await Promise.all([
          contarPorSituacao("ABERTO"),
          contarPorSituacao("CONVERTIDO"),
        ]);
        return NextResponse.json(
          {
            items: [],
            page,
            limit,
            total: 0,
            totalPages: 1,
            counters: { ABERTO: abertos, CONVERTIDO: convertidos },
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    let query = supabaseAdmin
      .from("orcamento")
      .select(SELECT_LISTA, { count: "exact" })
      .eq("is_deleted", false)
      .order("id", { ascending: false })
      .range(from, to);

    if (situacao) query = query.eq("status", situacao);
    if (clienteIds) query = query.in("clienteid", clienteIds);
    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", dateTo);
    if (busca) {
      const numero = Number(busca.replace(/\D/g, ""));
      query = Number.isFinite(numero) && numero > 0
        ? query.or(`descricao.ilike.%${busca}%,id.eq.${numero}`)
        : query.ilike("descricao", `%${busca}%`);
    }

    const [{ data, error, count }, abertos, convertidos] = await Promise.all([
      query,
      contarPorSituacao("ABERTO"),
      contarPorSituacao("CONVERTIDO"),
    ]);

    if (error) throw error;

    const total = count ?? 0;

    return NextResponse.json(
      {
        items: data ?? [],
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        counters: { ABERTO: abertos, CONVERTIDO: convertidos },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: any) {
    console.error("GET /api/orcamentos", err);
    return NextResponse.json(
      { error: err?.message || "Falha ao listar orçamentos" },
      { status: err?.statusCode || 500 },
    );
  }
}

/* =========================================================
 * POST — cria cabecalho e itens numa unica chamada
 *
 * Nao existe rascunho no banco: a tela monta o carrinho em memoria e grava
 * tudo de uma vez, entao desistir do dialog nao deixa linha orfa.
 * ========================================================= */
export async function POST(req: NextRequest) {
  let orcamentoCriadoId: number | null = null;

  try {
    await requireOrcamentosCreate();
    const session = await auth();
    const usuariocriadorid = (session?.user as any)?.id as string | undefined;
    if (!usuariocriadorid) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    const clienteid =
      body?.clienteid === null || body?.clienteid === undefined ? null : Number(body.clienteid);
    const veiculoid =
      body?.veiculoid === null || body?.veiculoid === undefined ? null : Number(body.veiculoid);

    if (clienteid !== null && !Number.isInteger(clienteid)) {
      return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
    }
    if (veiculoid !== null && !Number.isInteger(veiculoid)) {
      return NextResponse.json({ error: "Veículo inválido." }, { status: 400 });
    }

    const itens = normalizarItens(body);
    if (
      itens.produtos.length === 0 &&
      itens.servicos.length === 0 &&
      itens.produtosAvulsos.length === 0
    ) {
      return NextResponse.json(
        { error: "Adicione ao menos um produto ou serviço ao orçamento." },
        { status: 400 },
      );
    }

    const { data: criado, error: erroCriacao } = await supabaseAdmin
      .from("orcamento")
      .insert({
        clienteid,
        veiculoid,
        usuariocriadorid,
        status: "ABERTO",
        descricao: body?.descricao ? String(body.descricao).trim() || null : null,
        observacoes: body?.observacoes ? String(body.observacoes).trim() || null : null,
        ...itens.cabecalho,
        created_by: usuariocriadorid,
        updated_by: usuariocriadorid,
      })
      .select("id")
      .single();

    if (erroCriacao) throw erroCriacao;
    orcamentoCriadoId = Number(criado.id);

    await gravarItensDoOrcamento(orcamentoCriadoId, itens);

    return NextResponse.json({ id: orcamentoCriadoId }, { status: 201 });
  } catch (err: any) {
    // Sem transacao no PostgREST: se os itens falharem, o cabecalho ja gravado
    // viraria um orcamento vazio e invisivel para o usuario. Desfazemos a mao.
    if (orcamentoCriadoId) {
      await supabaseAdmin.from("orcamento").delete().eq("id", orcamentoCriadoId);
    }

    if (err instanceof OrcamentoInvalidoError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    console.error("POST /api/orcamentos", err);
    return NextResponse.json(
      { error: err?.message || "Falha ao criar orçamento" },
      { status: err?.statusCode || 500 },
    );
  }
}
