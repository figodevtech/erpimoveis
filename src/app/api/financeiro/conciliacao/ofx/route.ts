export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/** Histórico de importações de extrato, da mais recente para a mais antiga. */
export async function GET(req: Request) {
  try {
    await requireFinanceirosAccess();

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
    const bancoId = Number(url.searchParams.get("bancoId"));

    let consulta = supabaseAdmin
      .from("ofx_importacao")
      .select(
        "id, banco_id, arquivo_nome, arquivo_hash, periodo_inicio, periodo_fim, saldo_inicial, saldo_final, quantidade_movimentos, quantidade_importados, quantidade_repetidos, created_at, created_by, banco:banco_id (id, titulo)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (Number.isSafeInteger(bancoId) && bancoId > 0) {
      consulta = consulta.eq("banco_id", bancoId);
    }

    const { data, error, count } = await consulta;
    if (error) throw error;

    const importacoes = (data ?? []) as any[];
    const ids = importacoes.map((item) => Number(item.id));

    /*
     * As contagens por situação vêm numa consulta só e são somadas aqui. Um
     * `count` por importação seria uma ida ao banco por linha da lista, e a
     * pergunta ("quantos ainda faltam?") é a mesma para todas.
     */
    const porImportacao = new Map<number, { conciliados: number; pendentes: number; ignorados: number }>();
    if (ids.length) {
      const { data: movimentos, error: erroMovimentos } = await supabaseAdmin
        .from("ofx_movimento")
        .select("importacao_id, status")
        .in("importacao_id", ids);

      if (erroMovimentos) throw erroMovimentos;

      for (const linha of movimentos ?? []) {
        const chave = Number(linha.importacao_id);
        const atual = porImportacao.get(chave) ?? { conciliados: 0, pendentes: 0, ignorados: 0 };
        if (linha.status === "CONCILIADO") atual.conciliados += 1;
        else if (linha.status === "IGNORADO") atual.ignorados += 1;
        else atual.pendentes += 1;
        porImportacao.set(chave, atual);
      }
    }

    const usuarios = await carregarUsuarios(importacoes.map((item) => item.created_by));

    return NextResponse.json({
      data: importacoes.map((item) => ({
        ...item,
        usuario: usuarios.get(String(item.created_by)) ?? null,
        situacoes:
          porImportacao.get(Number(item.id)) ?? { conciliados: 0, pendentes: 0, ignorados: 0 },
      })),
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: count ? Math.ceil(count / limit) : 0,
      },
    });
  } catch (error: any) {
    const statusCode = Number(error?.statusCode ?? 500);
    if (statusCode === 401 || statusCode === 403) {
      return NextResponse.json({ error: error.message }, { status: statusCode });
    }

    console.error("GET /api/financeiro/conciliacao/ofx", error);
    return NextResponse.json(
      { error: "Não foi possível carregar as importações." },
      { status: 500 },
    );
  }
}

/** Nome de quem importou. Sem join: `created_by` aponta para usuário, não é FK. */
async function carregarUsuarios(ids: Array<string | null>): Promise<Map<string, string>> {
  const unicos = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  const mapa = new Map<string, string>();
  if (unicos.length === 0) return mapa;

  const { data } = await supabaseAdmin.from("usuario").select("id, nome").in("id", unicos);
  for (const linha of data ?? []) mapa.set(String(linha.id), String(linha.nome ?? ""));
  return mapa;
}
