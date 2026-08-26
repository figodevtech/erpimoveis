import { NextRequest, NextResponse } from "next/server";
import { requireUsoConsumoAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { escopoDaBusca, normalizeSearch, usoConsumoError } from "@/lib/usoconsumo/api";
import { USOCONSUMO_ITEM_SELECT_FIELDS } from "@/lib/usoconsumo/fields";

export async function GET(req: NextRequest) {
  try {
    await requireUsoConsumoAccess();
    const escopo = escopoDaBusca(req.nextUrl.searchParams);
    const search = normalizeSearch(req.nextUrl.searchParams.get("search"));
    const fornecedorId = Number(req.nextUrl.searchParams.get("fornecedorId"));
    const codigoFornecedor = normalizeSearch(req.nextUrl.searchParams.get("codigoFornecedor"));
    let query = supabaseAdmin.from("usoconsumo_item")
      .select(USOCONSUMO_ITEM_SELECT_FIELDS)
      .eq("ativo", true).eq("escopo", escopo).order("titulo").limit(50);
    if (search) query = query.or([
      `titulo.ilike.%${search}%`,`referencia.ilike.%${search}%`,`fabricante.ilike.%${search}%`,
      `codigobarras.ilike.%${search}%`,`etiqueta.ilike.%${search}%`,
    ].join(","));
    const { data, error } = await query;
    if (error) throw error;

    let suggestedId: number | null = null;
    if (Number.isInteger(fornecedorId) && fornecedorId > 0 && codigoFornecedor) {
      const { data: relation, error: relationError } = await supabaseAdmin.from("usoconsumo_fornecedor_item")
        .select("item_id").eq("fornecedor_id", fornecedorId).eq("codigo_fornecedor", codigoFornecedor).maybeSingle();
      if (relationError) throw relationError;
      suggestedId = relation?.item_id ?? null;
    }
    return NextResponse.json({ data: data ?? [], suggestedId });
  } catch (error) {
    return usoConsumoError(error, "Erro ao pesquisar itens.");
  }
}

