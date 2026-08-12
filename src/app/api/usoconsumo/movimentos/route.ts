export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUsoConsumoAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";

/**
 * Historico de uso e consumo: entradas e saidas na mesma linha do tempo.
 *
 * A tela juntava `/entradas` e `/saidas` no navegador, o que so funcionava
 * enquanto os dois lotes baixados cobrissem o periodo olhado — a busca nao
 * enxergava o resto e o total exibido era o do lote. Aqui a uniao ja vem do
 * banco (`usoconsumo_movimento_historico`), com busca, filtro e paginacao
 * aplicados sobre o conjunto inteiro.
 */

const SENTIDOS = new Set(["entrada", "saida"]);
const STATUS = new Set(["CONFIRMADA", "CANCELADA"]);

const LIMITE_MAXIMO = 500;
const MAX_TERMOS_BUSCA = 6;

/** Mesma limpeza da rota de produtos: sem curinga de LIKE vindo do usuario. */
function termosDeBusca(valor: string | null) {
  return (valor ?? "")
    .replace(/[%_*(),]/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_TERMOS_BUSCA);
}

/** Busca de uma vez quais entradas fiscais da pagina possuem transacao ativa. */
async function entradasComLancamentoFinanceiro(linhas: any[]) {
  const entradaIds = [
    ...new Set(
      linhas
        .filter(
          (linha) =>
            linha.sentido === "entrada" &&
            linha.fiscal === true &&
            linha.id != null,
        )
        .map((linha) => Number(linha.id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];

  if (!entradaIds.length) return new Set<number>();

  const { data, error } = await supabaseAdmin
    .from("transacao")
    .select("usoconsumo_entrada_id")
    .in("usoconsumo_entrada_id", entradaIds)
    .eq("is_deleted", false);
  if (error) throw error;

  return new Set(
    (data ?? [])
      .map((transacao) => Number(transacao.usoconsumo_entrada_id))
      .filter((id) => Number.isInteger(id) && id > 0),
  );
}

export async function GET(req: NextRequest) {
  try {
    await requireUsoConsumoAccess();

    const params = req.nextUrl.searchParams;
    const page = Math.max(Number(params.get("page")) || 1, 1);
    const limit = Math.min(Math.max(Number(params.get("limit")) || 50, 1), LIMITE_MAXIMO);
    const from = (page - 1) * limit;

    let query = supabaseAdmin
      .from("usoconsumo_movimento_historico")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    const sentido = (params.get("sentido") ?? "").toLowerCase();
    if (SENTIDOS.has(sentido)) query = query.eq("sentido", sentido);

    const status = (params.get("status") ?? "").toUpperCase();
    if (STATUS.has(status)) query = query.eq("status", status);

    const fiscal = (params.get("fiscal") ?? "").toLowerCase();
    if (fiscal === "com_nf") query = query.eq("fiscal", true);
    if (fiscal === "sem_nf") query = query.eq("fiscal", false);

    const desde = params.get("desde");
    if (desde) query = query.gte("created_at", desde);

    const ate = params.get("ate");
    if (ate) query = query.lte("created_at", ate);

    for (const termo of termosDeBusca(params.get("q"))) {
      query = query.ilike("busca", `%${termo}%`);
    }

    const { data, error, count } = await query.range(from, from + limit - 1);
    if (error) throw error;

    const linhas = data ?? [];
    const entradasComFinanceiro = await entradasComLancamentoFinanceiro(linhas);
    const total = count ?? 0;
    return NextResponse.json({
      data: linhas.map((linha) => ({
        ...linha,
        financeiro_lancado:
          linha.sentido === "entrada" && linha.fiscal === true
            ? entradasComFinanceiro.has(Number(linha.id))
            : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    return usoConsumoError(error, "Erro ao listar o histórico de uso e consumo.");
  }
}
