export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mensagemDoErro, statusDoErro } from "@/lib/financeiro/plano-contas/erros";

/**
 * Catálogo de classificação de resultado.
 *
 * A tela de cadastro precisa oferecer destinos possíveis sem que o usuário
 * conheça códigos de linha da DRE. O que ele escolhe é o significado — "receita
 * de serviços" —; a linha é consequência.
 *
 * Só leitura: alterar o catálogo é mudar o significado comum a todos os bancos,
 * e isso exige uma versão nova, não um PUT.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();

    const { searchParams } = new URL(req.url);
    const familia = (searchParams.get("familia") ?? "").trim();

    let query = supabaseAdmin
      .from("classificacoes_resultado")
      .select(
        "id, codigo, nome, descricao, familia, tratamento, naturezas, papel_dre, motivo_exclusao, observacao, versao_catalogo, ativo",
      )
      .eq("ativo", true)
      .order("familia")
      .order("codigo");

    if (familia) query = query.eq("familia", familia);

    const { data, error } = await query;
    if (error) throw error;

    // O destino é do mapeamento, não da classificação: a mesma chave pode
    // apontar para linhas diferentes em versões diferentes do template.
    const { data: destinos, error: erroDestinos } = await supabaseAdmin
      .from("dre_mapeamento")
      .select("classificacao_resultado_id, exclui_do_resultado, linha:dre_linha(codigo, nome)")
      .eq("origem_tipo", "CLASSIFICACAO_RESULTADO")
      .eq("ativo", true);
    if (erroDestinos) throw erroDestinos;

    const porClassificacao = new Map<number, { codigo: string | null; nome: string | null; exclui: boolean }>();
    for (const linha of destinos ?? []) {
      const destino = Array.isArray(linha.linha) ? linha.linha[0] : linha.linha;
      porClassificacao.set(Number(linha.classificacao_resultado_id), {
        codigo: (destino?.codigo as string | undefined) ?? null,
        nome: (destino?.nome as string | undefined) ?? null,
        exclui: Boolean(linha.exclui_do_resultado),
      });
    }

    const items = (data ?? []).map((c) => {
      const destino = porClassificacao.get(Number(c.id));
      return {
        id: Number(c.id),
        codigo: String(c.codigo),
        nome: String(c.nome),
        descricao: String(c.descricao ?? ""),
        familia: String(c.familia),
        tratamento: String(c.tratamento),
        naturezas: (c.naturezas ?? []) as string[],
        papel_dre: (c.papel_dre as string | null) ?? null,
        motivo_exclusao: (c.motivo_exclusao as string | null) ?? null,
        observacao: (c.observacao as string | null) ?? null,
        versao_catalogo: Number(c.versao_catalogo ?? 1),
        destino: destino
          ? {
              fora_da_dre: destino.exclui,
              linha_codigo: destino.codigo,
              linha_nome: destino.nome,
            }
          : null,
      };
    });

    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[/api/tipos/classificacoes-resultado GET]", error);
    return NextResponse.json(
      { error: mensagemDoErro(error, "Erro ao carregar o catálogo de classificações") },
      { status: statusDoErro(error) },
    );
  }
}
