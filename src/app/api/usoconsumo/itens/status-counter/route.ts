import { NextRequest, NextResponse } from "next/server";
import { requireUsoConsumoAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { escopoDaBusca, usoConsumoError } from "@/lib/usoconsumo/api";

export async function GET(req: NextRequest) {
  try {
    await requireUsoConsumoAccess();
    const escopo = escopoDaBusca(req.nextUrl.searchParams);
    const statuses = ["OK","BAIXO","CRITICO","SEM_ESTOQUE"] as const;
    const results = await Promise.all(statuses.map((status) => supabaseAdmin.from("usoconsumo_item")
      .select("id", { count: "exact", head: true })
      .eq("ativo", true).eq("escopo", escopo).eq("status_estoque", status)));
    const error = results.find((result) => result.error)?.error;
    if (error) throw error;
    const data = Object.fromEntries(statuses.map((status, index) => [status, results[index].count ?? 0])) as Record<string, number>;
    data.TODOS = statuses.reduce((total, status) => total + data[status], 0);
    return NextResponse.json({ data });
  } catch (error) {
    return usoConsumoError(error, "Erro ao contar itens.");
  }
}

