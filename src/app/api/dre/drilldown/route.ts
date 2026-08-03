// src/app/api/dre/drilldown/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireFinanceirosAccess } from "@/app/api/_authz/perms";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

type Registro = Record<string, unknown>;

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const texto = (v: unknown) => (v == null ? null : String(v));

/** Linha clicada mais toda a subarvore: quem abre "CUSTOS" espera ver 4.1 a 4.7. */
async function descendentes(templateId: number, linhaId: number): Promise<number[]> {
  const { data, error } = await supabaseAdmin
    .from("dre_linha")
    .select("id, parent_id")
    .eq("template_id", templateId)
    .eq("ativo", true);

  if (error) throw error;

  const filhosDe = new Map<number, number[]>();
  for (const row of (data ?? []) as Registro[]) {
    const pai = row.parent_id == null ? null : Number(row.parent_id);
    if (pai == null) continue;
    filhosDe.set(pai, [...(filhosDe.get(pai) ?? []), Number(row.id)]);
  }

  const resultado: number[] = [];
  const pilha = [linhaId];
  while (pilha.length) {
    const atual = pilha.pop()!;
    resultado.push(atual);
    pilha.push(...(filhosDe.get(atual) ?? []));
  }

  return resultado;
}

export async function GET(req: Request) {
  try {
    await requireFinanceirosAccess();

    const { searchParams } = new URL(req.url);
    const de = (searchParams.get("de") ?? "").trim();
    const ate = (searchParams.get("ate") ?? "").trim();
    const linhaId = Number(searchParams.get("linha"));

    if (!DATA_ISO.test(de) || !DATA_ISO.test(ate) || !Number.isFinite(linhaId)) {
      return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
    }

    const { data: linha, error: erroLinha } = await supabaseAdmin
      .from("dre_linha")
      .select("id, template_id, codigo, nome, tipo")
      .eq("id", linhaId)
      .maybeSingle();

    if (erroLinha) throw erroLinha;
    if (!linha) return NextResponse.json({ error: "Linha não encontrada." }, { status: 404 });

    const registro = linha as Registro;
    const templateId = Number(registro.template_id);

    // Linha de formula e resultado de calculo, nao de lancamentos.
    if (String(registro.tipo) === "FORMULA") {
      return NextResponse.json(
        {
          linha: { id: linhaId, codigo: registro.codigo, nome: registro.nome, calculada: true },
          items: [],
          total: 0,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const ids = await descendentes(templateId, linhaId);

    const { data, error } = await supabaseAdmin.rpc("dre_lancamentos_por_linha", {
      p_template_id: templateId,
      p_linha_ids: ids,
      p_de: `${de}T00:00:00.000Z`,
      p_ate: `${ate}T23:59:59.999Z`,
    });

    if (error) throw error;

    const items = ((data ?? []) as Registro[]).map((row) => ({
      id: Number(row.id),
      competenciaEm: texto(row.competencia_em),
      origem: texto(row.origem),
      natureza: texto(row.natureza),
      naturezaDre: texto(row.natureza_dre),
      descricao: texto(row.descricao) ?? "—",
      detalhe: texto(row.detalhe),
      valor: num(row.valor),
      sourceType: texto(row.source_type),
      sourceId: row.source_id == null ? null : Number(row.source_id),
      ordemServicoId: row.ordemservicoid == null ? null : Number(row.ordemservicoid),
      transacaoId: row.transacaoid == null ? null : Number(row.transacaoid),
      isManual: row.is_manual === true,
      isEstorno: row.estorno_de_id != null,
      semCusto: row.sem_custo === true,
    }));

    return NextResponse.json(
      {
        linha: { id: linhaId, codigo: registro.codigo, nome: registro.nome, calculada: false },
        items,
        total: Number(items.reduce((acc, i) => acc + i.valor, 0).toFixed(2)),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Erro ao carregar os lançamentos";
    console.error("[GET /api/dre/drilldown]", e);
    return NextResponse.json({ error: mensagem }, { status: /forbidden|permiss/i.test(mensagem) ? 403 : 500 });
  }
}
