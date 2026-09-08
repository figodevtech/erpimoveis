export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mensagemDoErro, statusDoErro } from "@/lib/financeiro/plano-contas/erros";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

type Resumo = {
  motivo: string;
  descricao: string;
  escopo: string;
  quantidade: number | string;
  valor: number | string | null;
};

type Item = {
  referencia_tipo: string;
  referencia_id: number | string;
  descricao: string | null;
  grupo_nome: string | null;
  conta_nome: string | null;
  competencia: string | null;
  valor: number | string | null;
};

/**
 * GET /api/dre/pendencias?de=&ate=[&motivo=&limite=&deslocamento=]
 *
 * Sem `motivo`, devolve o resumo por motivo, com quantidade E valor. Com
 * `motivo`, devolve os itens daquele motivo, paginados.
 *
 * Se a consulta falhar, a resposta é erro — nunca uma lista vazia. Uma fila que
 * devolve zero quando não conseguiu ler faz a tela dizer "sem pendências", que é
 * a pior resposta possível: parece completude e é ignorância.
 */
export async function GET(req: Request) {
  try {
    await requireFinanceirosAccess();

    const { searchParams } = new URL(req.url);
    const de = (searchParams.get("de") ?? "").trim();
    const ate = (searchParams.get("ate") ?? "").trim();
    const motivo = (searchParams.get("motivo") ?? "").trim();

    if (!DATA_ISO.test(de) || !DATA_ISO.test(ate)) {
      return NextResponse.json({ error: "Informe o período (de/ate) no formato AAAA-MM-DD." }, { status: 400 });
    }

    const inicio = `${de}T00:00:00.000Z`;
    const fim = `${ate}T23:59:59.999Z`;

    if (motivo) {
      const limite = Number(searchParams.get("limite") ?? 100);
      const deslocamento = Number(searchParams.get("deslocamento") ?? 0);

      const { data, error } = await supabaseAdmin.rpc("dre_pendencias_itens", {
        p_motivo: motivo,
        p_de: inicio,
        p_ate: fim,
        p_limite: Number.isFinite(limite) ? limite : 100,
        p_deslocamento: Number.isFinite(deslocamento) ? Math.max(0, deslocamento) : 0,
      });
      if (error) throw error;

      const itens = ((data ?? []) as Item[]).map((item) => ({
        referencia_tipo: item.referencia_tipo,
        referencia_id: Number(item.referencia_id),
        descricao: item.descricao ?? null,
        grupo: item.grupo_nome ?? null,
        conta: item.conta_nome ?? null,
        competencia: item.competencia ?? null,
        valor: item.valor === null ? null : Number(item.valor),
      }));

      return NextResponse.json({ motivo, periodo: { de, ate }, itens }, { headers: { "Cache-Control": "no-store" } });
    }

    const { data, error } = await supabaseAdmin.rpc("dre_pendencias", { p_de: inicio, p_ate: fim });
    if (error) throw error;

    const resumo = ((data ?? []) as Resumo[]).map((linha) => ({
      motivo: linha.motivo,
      descricao: linha.descricao,
      escopo: linha.escopo,
      quantidade: Number(linha.quantidade ?? 0),
      valor: linha.valor === null ? null : Number(linha.valor),
    }));

    return NextResponse.json(
      {
        periodo: { de, ate },
        resumo,
        totais: {
          itens: resumo.reduce((total, linha) => total + linha.quantidade, 0),
          valor: resumo.reduce((total, linha) => total + (linha.valor ?? 0), 0),
        },
        atualizadoEm: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[GET /api/dre/pendencias]", error);
    return NextResponse.json(
      { error: mensagemDoErro(error, "Erro ao carregar as pendências da DRE") },
      { status: statusDoErro(error) },
    );
  }
}
