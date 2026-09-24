export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated, requirePerm } from "@/app/api/_authz/perms";
import { tipoPermission } from "@/app/api/_authz/permission-constants";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mensagemDoErro, statusDoErro } from "@/lib/financeiro/plano-contas/erros";
import { mapearGrupo, type LinhaVisaoGrupo } from "./_mapa";

async function listar(competencia: string | null) {
  const { data, error } = await supabaseAdmin.rpc("plano_contas_grupos_visao", {
    p_competencia: competencia && /^\d{4}-\d{2}-\d{2}$/.test(competencia) ? competencia : null,
  });
  if (error) throw error;
  return (data ?? []) as LinhaVisaoGrupo[];
}

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();

    const url = new URL(req.url);
    const ativo = url.searchParams.get("ativo");

    let linhas = await listar(url.searchParams.get("competencia"));
    if (ativo === "true") linhas = linhas.filter((l) => l.ativo);
    if (ativo === "false") linhas = linhas.filter((l) => !l.ativo);

    return NextResponse.json({ items: linhas.map(mapearGrupo) });
  } catch (error) {
    console.error("[/api/tipos/grupos-planos-de-conta GET]", error);
    return NextResponse.json(
      { error: mensagemDoErro(error, "Erro ao carregar grupos de planos de conta") },
      { status: statusDoErro(error) },
    );
  }
}

/**
 * Um grupo novo deveria nascer com classificação — é ela que as contas herdam.
 * Criar sem classificação continua permitido, e o grupo aparece como pendente:
 * recusar aqui impediria a oficina de organizar o cadastro antes de decidir o
 * destino, e transformaria uma pendência visível numa porta fechada.
 */
export async function POST(req: NextRequest) {
  try {
    await requirePerm(tipoPermission("planos_conta", "criar"));

    const body = await req.json().catch(() => ({}));
    const codigo = String(body.codigo ?? "").trim();
    const nome = String(body.nome ?? "").trim();

    if (!codigo) return NextResponse.json({ error: "Código do grupo é obrigatório." }, { status: 400 });
    if (!nome) return NextResponse.json({ error: "Nome do grupo é obrigatório." }, { status: 400 });

    const { data, error } = await supabaseAdmin.rpc("plano_contas_salvar_grupo", {
      p_id: null,
      p_codigo: codigo,
      p_nome: nome,
      p_descricao: body.descricao ?? null,
      p_ativo: typeof body.ativo === "boolean" ? body.ativo : true,
      p_classificacao_id: body.classificacao_id ? Number(body.classificacao_id) : null,
      p_versao_esperada: null,
      p_vigencia_inicio: body.vigencia_inicio ?? null,
      p_usuario: null,
      p_justificativa: body.justificativa ?? null,
    });
    if (error) throw error;

    const id = Number((data as { id?: number } | null)?.id);
    const linha = (await listar(null)).find((l) => Number(l.grupo_id) === id);
    if (!linha) return NextResponse.json({ error: "Falha ao criar grupo." }, { status: 500 });

    return NextResponse.json({ item: mapearGrupo(linha) }, { status: 201 });
  } catch (error) {
    console.error("[/api/tipos/grupos-planos-de-conta POST]", error);
    return NextResponse.json(
      { error: mensagemDoErro(error, "Erro ao criar grupo") },
      { status: statusDoErro(error) },
    );
  }
}
