// src/app/api/orcamentos/[id]/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  requireOrcamentosAccess,
  requireOrcamentosDelete,
  requireOrcamentosEdit,
} from "@/app/api/_authz/perms";
import { normalizarAlvoOrcamento } from "@/lib/orcamentos/alvo";
import { normalizarItens, OrcamentoInvalidoError } from "@/lib/orcamentos/itens";
import { carregarItensDoOrcamento, gravarItensDoOrcamento } from "@/lib/orcamentos/persistencia";

const SELECT_CABECALHO = `
  id,
  status,
  clienteid,
  veiculoid,
  descricao,
  observacoes,
  subtotal,
  desconto_tipo,
  desconto,
  valor_frete,
  total,
  created_at,
  updated_at,
  alvo_tipo,
  peca_titulo,
  peca_descricao,
  peca_lacre,
  equipamento_nome,
  equipamento_patrimonio,
  equipamento_ano,
  equipamento_horimetro,
  cliente:clienteid ( id, nomerazaosocial, cpfcnpj, telefone, email ),
  veiculo:veiculoid ( id, placa, modelo, marca, ano, cor ),
  criador:usuariocriadorid ( id, nome )
`;

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function buscarOrcamento(id: number) {
  const { data, error } = await supabaseAdmin
    .from("orcamento")
    .select(SELECT_CABECALHO)
    .eq("id", id)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/* =========================================================
 * GET — cabecalho + itens, no formato que o carrinho consome
 * ========================================================= */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireOrcamentosAccess();

    const { id } = await ctx.params;
    const orcamentoId = parseId(id);
    if (!orcamentoId) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const orcamento = await buscarOrcamento(orcamentoId);
    if (!orcamento) {
      return NextResponse.json({ error: "Orçamento não encontrado." }, { status: 404 });
    }

    const itens = await carregarItensDoOrcamento(orcamentoId);

    // A OS gerada e informativa na tela: mostra para onde o orcamento foi.
    const { data: ordens, error: ordensError } = await supabaseAdmin
      .from("ordemservico")
      .select("id, status")
      .eq("orcamentoid", orcamentoId)
      .eq("is_deleted", false)
      .order("id", { ascending: true });
    if (ordensError) throw ordensError;

    return NextResponse.json(
      {
        ...orcamento,
        ...itens,
        descontoTipo: (orcamento as any).desconto_tipo ?? null,
        valorFrete: Number((orcamento as any).valor_frete ?? 0),
        // Aliases do alvo no formato que o formulario monta de volta no PUT —
        // assim a tela nao precisa saber que peca e equipamento moram em
        // colunas soltas.
        alvoTipo: (orcamento as any).alvo_tipo ?? "VEICULO",
        peca: (orcamento as any).peca_titulo
          ? {
              titulo: String((orcamento as any).peca_titulo),
              descricao: (orcamento as any).peca_descricao ?? null,
              lacre: (orcamento as any).peca_lacre ?? null,
            }
          : null,
        equipamento: (orcamento as any).equipamento_nome
          ? {
              nome: String((orcamento as any).equipamento_nome),
              patrimonio: (orcamento as any).equipamento_patrimonio ?? null,
              ano: (orcamento as any).equipamento_ano ?? null,
              horimetro: (orcamento as any).equipamento_horimetro ?? null,
            }
          : null,
        ordensGeradas: ordens ?? [],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: any) {
    console.error("GET /api/orcamentos/[id]", err);
    return NextResponse.json(
      { error: err?.message || "Falha ao carregar orçamento" },
      { status: err?.statusCode || 500 },
    );
  }
}

/* =========================================================
 * PUT — regrava cabecalho e itens
 * ========================================================= */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireOrcamentosEdit();
    const session = await auth();
    const usuarioId = (session?.user as any)?.id as string | undefined;

    const { id } = await ctx.params;
    const orcamentoId = parseId(id);
    if (!orcamentoId) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const atual = await buscarOrcamento(orcamentoId);
    if (!atual) {
      return NextResponse.json({ error: "Orçamento não encontrado." }, { status: 404 });
    }

    // Um orcamento que ja virou OS e o documento que justifica aquela OS.
    // Reescrever os itens depois faria a OS deixar de bater com o que foi
    // combinado com o cliente.
    if ((atual as any).status === "CONVERTIDO") {
      return NextResponse.json(
        { error: "Este orçamento já gerou uma OS e não pode mais ser alterado." },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));

    const clienteid =
      body?.clienteid === null || body?.clienteid === undefined ? null : Number(body.clienteid);

    if (clienteid !== null && !Number.isInteger(clienteid)) {
      return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
    }

    const alvo = normalizarAlvoOrcamento(body);
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

    const { error: erroCabecalho } = await supabaseAdmin
      .from("orcamento")
      .update({
        clienteid,
        ...alvo,
        descricao: body?.descricao ? String(body.descricao).trim() || null : null,
        observacoes: body?.observacoes ? String(body.observacoes).trim() || null : null,
        ...itens.cabecalho,
        updated_by: usuarioId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orcamentoId);

    if (erroCabecalho) throw erroCabecalho;

    await gravarItensDoOrcamento(orcamentoId, itens);

    return NextResponse.json({ ok: true, id: orcamentoId, ...itens.cabecalho });
  } catch (err: any) {
    if (err instanceof OrcamentoInvalidoError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    console.error("PUT /api/orcamentos/[id]", err);
    return NextResponse.json(
      { error: err?.message || "Falha ao salvar orçamento" },
      { status: err?.statusCode || 500 },
    );
  }
}

/* =========================================================
 * DELETE — descarte logico
 * ========================================================= */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireOrcamentosDelete();
    const session = await auth();
    const usuarioId = (session?.user as any)?.id as string | undefined;

    const { id } = await ctx.params;
    const orcamentoId = parseId(id);
    if (!orcamentoId) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const atual = await buscarOrcamento(orcamentoId);
    if (!atual) {
      return NextResponse.json({ error: "Orçamento não encontrado." }, { status: 404 });
    }

    // Descartar um orcamento convertido deixaria a OS sem a origem que explica
    // os valores dela — a FK ficaria nula e o rastro se perderia.
    if ((atual as any).status === "CONVERTIDO") {
      return NextResponse.json(
        { error: "Este orçamento já gerou uma OS e não pode ser descartado." },
        { status: 409 },
      );
    }

    const { error } = await supabaseAdmin
      .from("orcamento")
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: usuarioId ?? null,
      })
      .eq("id", orcamentoId);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("DELETE /api/orcamentos/[id]", err);
    return NextResponse.json(
      { error: err?.message || "Falha ao descartar orçamento" },
      { status: err?.statusCode || 500 },
    );
  }
}
