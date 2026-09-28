import { NextResponse } from "next/server";

import { requireDashboardAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProdutoResumo = {
  id: number;
  titulo: string;
  referencia: string | null;
  estoque: number;
  minimo: number;
  custo: number;
  valor: number;
  reposicaoSugerida: number;
};

function numero(valor: unknown) {
  const resultado = Number(valor ?? 0);
  return Number.isFinite(resultado) ? resultado : 0;
}

type ResumoEstoque = {
  totais?: Record<string, unknown>;
  reposicao?: unknown;
  maiorValor?: unknown;
};

function produtos(valor: unknown): ProdutoResumo[] {
  if (!Array.isArray(valor)) return [];
  return valor.map((bruto: unknown) => {
    const item = (bruto ?? {}) as Record<string, unknown>;
    return {
      id: numero(item.id),
      titulo: String(item.titulo ?? `Produto #${item.id}`),
      referencia: item.referencia ? String(item.referencia) : null,
      estoque: numero(item.estoque),
      minimo: numero(item.minimo),
      custo: numero(item.custo),
      valor: numero(item.valor),
      reposicaoSugerida: numero(item.reposicaoSugerida),
    };
  });
}

export async function GET() {
  try {
    await requireDashboardAccess();

    // Soma e escolhe os "top N" no banco (ver a migration
    // dashboard_estoque_resumo): o catalogo inteiro nao trafega mais.
    const { data, error } = await supabaseAdmin.rpc("dashboard_estoque_resumo");
    if (error) throw error;

    const resumo = (data ?? {}) as ResumoEstoque;
    const totais = resumo.totais ?? {};
    const zerados = numero(totais.zerados);
    const abaixoMinimo = numero(totais.abaixoMinimo);
    const adequados = numero(totais.adequados);
    const reposicao = produtos(resumo.reposicao);
    const maiorValor = produtos(resumo.maiorValor);

    return NextResponse.json(
      {
        totais: {
          produtos: numero(totais.produtos),
          unidades: numero(totais.unidades),
          valorEstoque: numero(totais.valorEstoque),
          zerados,
          abaixoMinimo,
          adequados,
          semCusto: numero(totais.semCusto),
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
