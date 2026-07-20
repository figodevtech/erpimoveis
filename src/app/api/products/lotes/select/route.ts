export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const LOTE_SELECT_FIELDS = `
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
`;

function respostaJSON(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  try {
    await requireEstoqueAccess();

    const { searchParams } = new URL(request.url);
    const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 20), 1), 100);
    const search = (searchParams.get("search") ?? "")
      .trim()
      .replace(/[,()%]/g, " ")
      .replace(/\s+/g, " ");
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseAdmin
      .from("lotes")
      .select(LOTE_SELECT_FIELDS, { count: "exact" })
      .order("id", { ascending: false })
      .range(from, to);

    if (search) {
      query = query.or(
        `placa.ilike.%${search}%,marca.ilike.%${search}%,modelo.ilike.%${search}%,versao.ilike.%${search}%`,
      );
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const items = data ?? [];
    const total = count ?? 0;

    return respostaJSON({
      data: items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        pageCount: items.length,
      },
    });
  } catch (error: any) {
    console.error("GET /api/products/lotes/select", error);
    const status = Number(error?.statusCode ?? 500);
    return respostaJSON(
      { error: error?.message ?? "Falha ao listar lotes" },
      status === 403 ? 403 : 500,
    );
  }
}
