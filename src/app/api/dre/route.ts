// src/app/api/dre/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { calcularDre } from "./_calculo";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function periodoAnterior(de: string, ate: string) {
  const inicio = new Date(`${de}T00:00:00.000Z`);
  const fim = new Date(`${ate}T00:00:00.000Z`);
  const dias = Math.max(1, Math.round((fim.getTime() - inicio.getTime()) / 86_400_000) + 1);

  const fimAnterior = new Date(inicio);
  fimAnterior.setUTCDate(fimAnterior.getUTCDate() - 1);
  const inicioAnterior = new Date(fimAnterior);
  inicioAnterior.setUTCDate(inicioAnterior.getUTCDate() - (dias - 1));

  return {
    de: inicioAnterior.toISOString().slice(0, 10),
    ate: fimAnterior.toISOString().slice(0, 10),
  };
}

export async function GET(req: Request) {
  try {
    await requireFinanceirosAccess();

    const { searchParams } = new URL(req.url);
    const de = (searchParams.get("de") ?? "").trim();
    const ate = (searchParams.get("ate") ?? "").trim();

    if (!DATA_ISO.test(de) || !DATA_ISO.test(ate)) {
      return NextResponse.json({ error: "Informe o período (de/ate) no formato AAAA-MM-DD." }, { status: 400 });
    }

    const anterior = periodoAnterior(de, ate);

    const dre = await calcularDre({
      de: `${de}T00:00:00.000Z`,
      ate: `${ate}T23:59:59.999Z`,
      deAnterior: `${anterior.de}T00:00:00.000Z`,
      ateAnterior: `${anterior.ate}T23:59:59.999Z`,
    });

    /*
     * Alertas do periodo. Existem porque o modulo pode estar tecnicamente
     * correto e ainda assim produzir um resultado enganoso: sem despesa lancada
     * o lucro aparece inflado, e sem custo de produto a margem vai a 100%. E
     * mais honesto avisar do que exibir o numero limpo.
     */
    const [pendencias, semCusto, semDespesa] = await Promise.all([
      supabaseAdmin
        .from("eventos_financeiros")
        .select("id", { count: "exact", head: true })
        .eq("status", "ATIVO")
        .eq("source_type", "TRANSACAO")
        .is("dre_linha_id", null)
        .gte("competencia_em", `${de}T00:00:00.000Z`)
        .lte("competencia_em", `${ate}T23:59:59.999Z`),
      supabaseAdmin
        .from("eventos_financeiros")
        .select("id", { count: "exact", head: true })
        .eq("status", "ATIVO")
        .eq("natureza_dre", "CUSTO")
        .contains("dados_snapshot", { custo_nao_informado: true })
        .gte("competencia_em", `${de}T00:00:00.000Z`)
        .lte("competencia_em", `${ate}T23:59:59.999Z`),
      supabaseAdmin
        .from("eventos_financeiros")
        .select("id", { count: "exact", head: true })
        .eq("status", "ATIVO")
        .eq("natureza_dre", "DESPESA")
        .gte("competencia_em", `${de}T00:00:00.000Z`)
        .lte("competencia_em", `${ate}T23:59:59.999Z`),
    ]);

    return NextResponse.json(
      {
        periodo: { de, ate, anterior },
        template: dre.template,
        linhas: dre.linhas,
        indicadores: dre.indicadorPorCodigo,
        alertas: {
          lancamentosSemClassificacao: pendencias.count ?? 0,
          itensSemCusto: semCusto.count ?? 0,
          semDespesaOperacional: (semDespesa.count ?? 0) === 0,
        },
        atualizadoEm: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Erro ao calcular a DRE";
    const status = /forbidden|permiss|autentic/i.test(mensagem) ? 403 : 500;
    console.error("[GET /api/dre]", e);
    return NextResponse.json({ error: mensagem }, { status });
  }
}
