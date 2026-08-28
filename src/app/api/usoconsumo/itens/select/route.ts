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

    // Paginação opcional: quem não manda page/limit (o combo do lançamento
    // manual e o auto-match da entrada fiscal) continua recebendo até 50
    // itens num lote só, igual ao teto fixo de antes.
    let page = Number(req.nextUrl.searchParams.get("page") || "1");
    let limit = Number(req.nextUrl.searchParams.get("limit") || "50");
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 50;
    if (limit > 100) limit = 100;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseAdmin.from("usoconsumo_item")
      .select(USOCONSUMO_ITEM_SELECT_FIELDS, { count: "exact" })
      .eq("ativo", true).eq("escopo", escopo).order("titulo");
    if (search) query = query.or([
      `titulo.ilike.%${search}%`,`referencia.ilike.%${search}%`,`fabricante.ilike.%${search}%`,
      `codigobarras.ilike.%${search}%`,`etiqueta.ilike.%${search}%`,
    ].join(","));
    const { data, error, count } = await query.range(from, to);
    if (error) throw error;

    let suggestedId: number | null = null;
    if (Number.isInteger(fornecedorId) && fornecedorId > 0 && codigoFornecedor) {
      const { data: relation, error: relationError } = await supabaseAdmin.from("usoconsumo_fornecedor_item")
        .select("item_id").eq("fornecedor_id", fornecedorId).eq("codigo_fornecedor", codigoFornecedor).maybeSingle();
      if (relationError) throw relationError;
      suggestedId = relation?.item_id ?? null;
    }

    const total = count ?? 0;
    const totalPages = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;

    return NextResponse.json({
      data: data ?? [],
      pagination: { total, page, limit, totalPages },
      suggestedId,
    });
  } catch (error) {
    return usoConsumoError(error, "Erro ao pesquisar itens.");
  }
}
