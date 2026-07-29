// /api/produtos/buscar/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";

export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    const codigo = (searchParams.get("codigo") || "").trim();

    const limit = Math.min(Number(searchParams.get("limit") ?? 50) || 50, 200);
    const from = Math.max(Number(searchParams.get("from") ?? 0) || 0, 0);
    const to = from + limit - 1;

    let query = supabase
      .from("produto")
      .select(
        "id, descricao, precovenda, estoque, codigobarras, referencia, titulo",
        { count: "exact" }
      )
      .range(from, to)
      .order("descricao", { ascending: true });

    // filtro por "codigo" → usa referencia (e aceita codigobarras como fallback para encontrar)
    if (codigo && !q) {
      query = (query as any).or(
        `referencia.ilike.%${codigo}%,codigobarras.ilike.%${codigo}%`
      );
    }

    // filtro amplo "q" → descricao/titulo/referencia/codigobarras
    if (q) {
      query = (query as any).or(
        `descricao.ilike.%${q}%,titulo.ilike.%${q}%,referencia.ilike.%${q}%,codigobarras.ilike.%${q}%`
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    const produtos = (data ?? []).map((p: any) => ({
      id: Number(p.id),
      // SEMPRE usa referencia como "codigo" (mesmo que tenha achado pelo codigobarras)
      codigo: String(p.referencia ?? ""),
      descricao: String(p.descricao ?? p.titulo ?? ""),
      precounitario: Number(p.precovenda ?? 0),
      estoque: Number(p.estoque ?? 0),
    }));

    return NextResponse.json(
      { produtos, total: produtos.length },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("GET /api/produtos/buscar", err);
    return NextResponse.json({ error: "Falha ao buscar produtos" }, { status: 500 });
  }
}
