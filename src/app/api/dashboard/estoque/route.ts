import { NextResponse } from "next/server";

import { requireDashboardAccess } from "@/app/api/_authz/perms";
import { fetchAllSupabaseRows } from "@/lib/supabase-pagination";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProdutoEstoque = {
  id: number;
  titulo: string | null;
  referencia: string | null;
  estoque: number | string | null;
  estoqueminimo: number | string | null;
  ultimovalordecompra: number | string | null;
  precocompra: number | string | null;
};

function numero(valor: unknown) {
  const resultado = Number(valor ?? 0);
  return Number.isFinite(resultado) ? resultado : 0;
}

export async function GET() {
  try {
    await requireDashboardAccess();

    const produtos = await fetchAllSupabaseRows<ProdutoEstoque>(() =>
      supabaseAdmin
        .from("produto")
        .select("id,titulo,referencia,estoque,estoqueminimo,ultimovalordecompra,precocompra")
        .eq("is_deleted", false)
        .order("id", { ascending: true }),
    );

    let unidades = 0;
    let valorEstoque = 0;
    let zerados = 0;
    let abaixoMinimo = 0;
    let adequados = 0;
    let semCusto = 0;

    const detalhados = produtos.map((produto) => {
      const estoque = numero(produto.estoque);
      const minimo = Math.max(0, numero(produto.estoqueminimo));
      const custo = numero(produto.ultimovalordecompra) || numero(produto.precocompra);
      const valor = Math.max(0, estoque) * custo;

      unidades += Math.max(0, estoque);
      valorEstoque += valor;
      if (custo <= 0) semCusto += 1;
      if (estoque <= 0) zerados += 1;
      else if (estoque <= minimo) abaixoMinimo += 1;
      else adequados += 1;

      return {
        id: Number(produto.id),
        titulo: produto.titulo || `Produto #${produto.id}`,
        referencia: produto.referencia || null,
        estoque,
        minimo,
        custo,
        valor,
        reposicaoSugerida: Math.max(0, minimo - estoque),
      };
    });

    const reposicao = detalhados
      .filter((produto) => produto.estoque <= produto.minimo)
      .sort((a, b) => {
        const aZerado = a.estoque <= 0 ? 1 : 0;
        const bZerado = b.estoque <= 0 ? 1 : 0;
        return bZerado - aZerado || b.reposicaoSugerida - a.reposicaoSugerida || a.estoque - b.estoque;
      })
      .slice(0, 10);

    const maiorValor = detalhados
      .filter((produto) => produto.valor > 0)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8);

    return NextResponse.json(
      {
        totais: {
          produtos: produtos.length,
          unidades,
          valorEstoque,
          zerados,
          abaixoMinimo,
          adequados,
          semCusto,
        },
        distribuicao: [
          { nome: "Zerados", valor: zerados, cor: "#ef4444" },
          { nome: "Abaixo do mínimo", valor: abaixoMinimo, cor: "#f59e0b" },
          { nome: "Estoque adequado", valor: adequados, cor: "#10b981" },
        ],
        reposicao,
        maiorValor,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    const status = Number(error?.statusCode);
    return NextResponse.json(
      { error: error?.message ?? "Não foi possível carregar o dashboard de estoque." },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}
