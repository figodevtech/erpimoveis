import { NextRequest, NextResponse } from "next/server";
import { requireUsoConsumoAccess, requireUsoConsumoCreate } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { escopoDaBusca, normalizeSearch, usoConsumoError } from "@/lib/usoconsumo/api";
import { USOCONSUMO_ITEM_FIELDS } from "@/lib/usoconsumo/fields";
import { usoConsumoItemCreateSchema, zodMessage } from "@/lib/usoconsumo/schemas";

export async function GET(req: NextRequest) {
  try {
    await requireUsoConsumoAccess();
    const params = req.nextUrl.searchParams;
    const page = Math.max(Number(params.get("page")) || 1, 1);
    const limit = Math.min(Math.max(Number(params.get("limit")) || 20, 1), 100);
    const from = (page - 1) * limit;
    const escopo = escopoDaBusca(params);
    const search = normalizeSearch(params.get("search"));
    const status = params.get("status")?.toUpperCase();
    const grupoId = Number(params.get("grupoId"));

    let query = supabaseAdmin.from("usoconsumo_item")
      .select(USOCONSUMO_ITEM_FIELDS, { count: "exact" })
      .eq("ativo", true).eq("escopo", escopo)
      .order("id", { ascending: false }).range(from, from + limit - 1);
    if (search) query = query.or([
      `titulo.ilike.%${search}%`, `descricao.ilike.%${search}%`, `referencia.ilike.%${search}%`,
      `fabricante.ilike.%${search}%`, `codigobarras.ilike.%${search}%`, `etiqueta.ilike.%${search}%`, `local.ilike.%${search}%`,
    ].join(","));
    if (status && ["OK","BAIXO","CRITICO","SEM_ESTOQUE"].includes(status)) query = query.eq("status_estoque", status);
    if (Number.isInteger(grupoId) && grupoId > 0) query = query.eq("grupo_id", grupoId);
    const { data, error, count } = await query;
    if (error) throw error;
    const total = count ?? 0;
    return NextResponse.json({ data, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (error) {
    return usoConsumoError(error, "Erro ao listar itens de uso e consumo.");
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireUsoConsumoCreate();
    const parsed = usoConsumoItemCreateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 });
    const session = await auth();
    const userId = (session?.user as { id?: string })?.id ?? null;
    const { estoqueInicial, ...item } = parsed.data;
    const { data, error } = await supabaseAdmin.rpc("criar_item_usoconsumo", {
      p_item: item, p_estoque_inicial: estoqueInicial, p_created_by: userId,
    });
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return usoConsumoError(error, "Erro ao cadastrar item.");
  }
}
