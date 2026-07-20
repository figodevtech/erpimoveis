export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireEstoqueAccess, requireEstoqueEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const VINCULO_FIELDS = `
  id,
  lote_id,
  produto_id,
  createdat,
  lote:lote_id (
    id,
    placa,
    marca,
    modelo,
    versao,
    ano,
    ano_modelo,
    tipo,
    valor_compra,
    "imgUrl",
    pecas:lote_pecas(id)
  )
`;

type Ctx = { params: Promise<{ id: string }> };

function respostaJSON(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function toPositiveInt(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizarVinculo(vinculo: any) {
  if (!vinculo) return null;
  return {
    ...vinculo,
    lote: Array.isArray(vinculo.lote) ? vinculo.lote[0] ?? null : vinculo.lote ?? null,
  };
}

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await requireEstoqueAccess();

    const { id: rawId } = await ctx.params;
    const produtoId = toPositiveInt(rawId);
    if (!produtoId) return respostaJSON({ error: "Produto inválido." }, 400);

    const { data, error } = await supabaseAdmin
      .from("lote_pecas")
      .select(VINCULO_FIELDS)
      .eq("produto_id", produtoId)
      .maybeSingle();

    if (error) throw error;
    return respostaJSON({ vinculo: normalizarVinculo(data) });
  } catch (error: any) {
    console.error("GET /api/products/[id]/lote", error);
    const status = Number(error?.statusCode ?? 500);
    return respostaJSON(
      { error: error?.message ?? "Falha ao buscar lote da peça" },
      status === 403 ? 403 : 500,
    );
  }
}

export async function PUT(request: Request, ctx: Ctx) {
  try {
    await requireEstoqueEdit();

    const { id: rawId } = await ctx.params;
    const produtoId = toPositiveInt(rawId);
    if (!produtoId) return respostaJSON({ error: "Produto inválido." }, 400);

    const body = await request.json().catch(() => null);
    const loteId = toPositiveInt(body?.loteId ?? body?.lote_id);
    if (!loteId) return respostaJSON({ error: "Lote inválido." }, 400);

    const [{ data: produto, error: produtoError }, { data: lote, error: loteError }] =
      await Promise.all([
        supabaseAdmin.from("produto").select("id").eq("id", produtoId).maybeSingle(),
        supabaseAdmin.from("lotes").select("id").eq("id", loteId).maybeSingle(),
      ]);

    if (produtoError) throw produtoError;
    if (loteError) throw loteError;
    if (!produto) return respostaJSON({ error: "Produto não encontrado." }, 404);
    if (!lote) return respostaJSON({ error: "Lote não encontrado." }, 404);

    const { data: existente, error: existenteError } = await supabaseAdmin
      .from("lote_pecas")
      .select("id, lote_id")
      .eq("produto_id", produtoId)
      .maybeSingle();

    if (existenteError) throw existenteError;

    const mutation = existente
      ? supabaseAdmin
          .from("lote_pecas")
          .update({ lote_id: loteId, updatedat: new Date().toISOString() })
          .eq("id", existente.id)
      : supabaseAdmin.from("lote_pecas").insert({ lote_id: loteId, produto_id: produtoId });

    const { data, error } = await mutation.select(VINCULO_FIELDS).single();
    if (error) throw error;

    return respostaJSON({ vinculo: normalizarVinculo(data) });
  } catch (error: any) {
    console.error("PUT /api/products/[id]/lote", error);
    const status = Number(error?.statusCode ?? 500);
    return respostaJSON(
      { error: error?.message ?? "Falha ao vincular lote à peça" },
      status === 403 ? 403 : 500,
    );
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    await requireEstoqueEdit();

    const { id: rawId } = await ctx.params;
    const produtoId = toPositiveInt(rawId);
    if (!produtoId) return respostaJSON({ error: "Produto inválido." }, 400);

    const { error } = await supabaseAdmin
      .from("lote_pecas")
      .delete()
      .eq("produto_id", produtoId);

    if (error) throw error;
    return respostaJSON({ ok: true });
  } catch (error: any) {
    console.error("DELETE /api/products/[id]/lote", error);
    const status = Number(error?.statusCode ?? 500);
    return respostaJSON(
      { error: error?.message ?? "Falha ao remover vínculo do lote" },
      status === 403 ? 403 : 500,
    );
  }
}
