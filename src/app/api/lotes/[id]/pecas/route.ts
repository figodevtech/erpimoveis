export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireDesmancheAccess, requireDesmancheEdit } from "@/app/api/_authz/perms";

function respostaJSON(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function toPositiveInt(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await requireDesmancheAccess();

    const { id: rawId } = await ctx.params;
    const loteId = toPositiveInt(rawId);
    if (!loteId) return respostaJSON({ error: "Parâmetro 'id' inválido." }, 400);

    const { data, error } = await supabaseAdmin
      .from("lote_pecas")
      .select(
        `
        id,
        lote_id,
        produto_id,
        createdat,
        produto:produto_id (
          id,
          titulo,
          referencia,
          fabricante,
          estoque,
          precovenda,
          conservacao,
          status_estoque
        )
      `,
      )
      .eq("lote_id", loteId)
      .order("id", { ascending: false });

    if (error) throw error;

    return respostaJSON({ pecas: data ?? [] });
  } catch (error: any) {
    console.error("GET /api/lotes/[id]/pecas", error);
    const status = Number(error?.statusCode ?? 500);
    return respostaJSON({ error: error?.message ?? "Falha ao listar peças do lote" }, status === 403 ? 403 : 500);
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    await requireDesmancheEdit();

    const { id: rawId } = await ctx.params;
    const loteId = toPositiveInt(rawId);
    if (!loteId) return respostaJSON({ error: "Parâmetro 'id' inválido." }, 400);

    const body = await request.json().catch(() => null);
    const produtoId = toPositiveInt(body?.produtoId ?? body?.produto_id);
    if (!produtoId) return respostaJSON({ error: "Campo 'produtoId' inválido." }, 400);

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("lote_pecas")
      .select("id, lote_id")
      .eq("produto_id", produtoId)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) {
      return respostaJSON(
        {
          error:
            Number(existing.lote_id) === loteId
              ? "Esta peça já está vinculada a este lote."
              : "Esta peça já pertence a outro lote.",
        },
        409,
      );
    }

    const { data, error } = await supabaseAdmin
      .from("lote_pecas")
      .insert({ lote_id: loteId, produto_id: produtoId })
      .select(
        `
        id,
        lote_id,
        produto_id,
        createdat,
        produto:produto_id (
          id,
          titulo,
          referencia,
          fabricante,
          estoque,
          precovenda,
          conservacao,
          status_estoque
        )
      `,
      )
      .single();

    if (error) {
      if ((error as any).code === "23505") {
        return respostaJSON({ error: "Esta peça já pertence a outro lote." }, 409);
      }
      throw error;
    }

    return respostaJSON({ peca: data }, 201);
  } catch (error: any) {
    console.error("POST /api/lotes/[id]/pecas", error);
    const status = Number(error?.statusCode ?? 500);
    return respostaJSON({ error: error?.message ?? "Falha ao vincular peça ao lote" }, status === 403 ? 403 : 500);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    await requireDesmancheEdit();

    const { id: rawId } = await ctx.params;
    const loteId = toPositiveInt(rawId);
    if (!loteId) return respostaJSON({ error: "Parâmetro 'id' inválido." }, 400);

    const { searchParams } = new URL(request.url);
    const relationId = toPositiveInt(searchParams.get("relationId"));
    const produtoId = toPositiveInt(searchParams.get("produtoId"));

    let query = supabaseAdmin.from("lote_pecas").delete().eq("lote_id", loteId);
    if (relationId) query = query.eq("id", relationId);
    else if (produtoId) query = query.eq("produto_id", produtoId);
    else return respostaJSON({ error: "Informe 'relationId' ou 'produtoId'." }, 400);

    const { error } = await query;
    if (error) throw error;

    return respostaJSON({ ok: true });
  } catch (error: any) {
    console.error("DELETE /api/lotes/[id]/pecas", error);
    const status = Number(error?.statusCode ?? 500);
    return respostaJSON({ error: error?.message ?? "Falha ao remover peça do lote" }, status === 403 ? 403 : 500);
  }
}
