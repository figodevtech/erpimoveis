export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireConfigEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mensagemDoErro, statusDoErro } from "@/lib/financeiro/plano-contas/erros";
import { mapearGrupo, type LinhaVisaoGrupo } from "../_mapa";

function parseId(valor: string) {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function reler(id: number) {
  const { data, error } = await supabaseAdmin.rpc("plano_contas_grupos_visao", { p_competencia: null });
  if (error) throw error;
  return ((data ?? []) as LinhaVisaoGrupo[]).find((l) => Number(l.grupo_id) === id) ?? null;
}

/**
 * PUT /api/tipos/grupos-planos-de-conta/[id]
 *
 * Trocar a classificação do grupo abre uma regra nova a partir da vigência
 * informada e fecha a anterior — competências passadas continuam resolvendo
 * pelo destino antigo. Renomear não abre regra nenhuma: nome é apresentação.
 *
 * Omitir `classificacao_id` preserva a atual; só `null` explícito a remove.
 */
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireConfigEdit();

    const { id: bruto } = await context.params;
    const id = parseId(bruto);
    if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const codigo = String(body.codigo ?? "").trim();
    const nome = String(body.nome ?? "").trim();
    if (!codigo) return NextResponse.json({ error: "Código do grupo é obrigatório." }, { status: 400 });
    if (!nome) return NextResponse.json({ error: "Nome do grupo é obrigatório." }, { status: 400 });

    const atual = await reler(id);
    if (!atual) return NextResponse.json({ error: "Grupo não encontrado." }, { status: 404 });

    const informouClassificacao = Object.prototype.hasOwnProperty.call(body, "classificacao_id");
    let classificacaoId: number | null = null;
    if (informouClassificacao) {
      classificacaoId = body.classificacao_id ? Number(body.classificacao_id) : null;
    } else if (atual.classificacao) {
      const { data } = await supabaseAdmin
        .from("classificacoes_resultado")
        .select("id")
        .eq("codigo", atual.classificacao)
        .maybeSingle();
      classificacaoId = data ? Number(data.id) : null;
    }

    const { error } = await supabaseAdmin.rpc("plano_contas_salvar_grupo", {
      p_id: id,
      p_codigo: codigo,
      p_nome: nome,
      p_descricao: body.descricao ?? null,
      p_ativo: typeof body.ativo === "boolean" ? body.ativo : null,
      p_classificacao_id: classificacaoId,
      p_versao_esperada: Number.isInteger(Number(body.versao_registro))
        ? Number(body.versao_registro)
        : null,
      p_vigencia_inicio: body.vigencia_inicio ?? null,
      p_usuario: null,
      p_justificativa: body.justificativa ?? null,
    });
    if (error) throw error;

    const linha = await reler(id);
    if (!linha) return NextResponse.json({ error: "Grupo não encontrado." }, { status: 404 });

    return NextResponse.json({ item: mapearGrupo(linha) });
  } catch (error) {
    console.error("[/api/tipos/grupos-planos-de-conta/:id PUT]", error);
    return NextResponse.json(
      { error: mensagemDoErro(error, "Erro ao atualizar grupo") },
      { status: statusDoErro(error) },
    );
  }
}
