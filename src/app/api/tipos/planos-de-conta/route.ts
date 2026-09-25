export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated, requirePerm } from "@/app/api/_authz/perms";
import { tipoPermission } from "@/app/api/_authz/permission-constants";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mensagemDoErro, statusDoErro } from "@/lib/financeiro/plano-contas/erros";
import { mapearConta, type LinhaVisaoConta } from "./_mapa";

/**
 * GET /api/tipos/planos-de-conta
 *
 * O contrato antigo continua inteiro — `id`, `codigo`, `nome`, `grupo`, `ativo`
 * — e ganha origem do cadastro, classificação herdada ou de exceção, destino na
 * DRE e versão do registro. Aditivo: o seletor do financeiro segue funcionando
 * sem alteração.
 *
 * A resolução vem de `plano_contas_visao`, a mesma função que a soma usa. Montar
 * a explicação aqui, a partir de consultas separadas, criaria uma segunda regra
 * — e a tela poderia prometer uma linha que a DRE não usa.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();

    const url = new URL(req.url);
    const ativo = url.searchParams.get("ativo");
    const competencia = url.searchParams.get("competencia");

    const { data, error } = await supabaseAdmin.rpc("plano_contas_visao", {
      p_competencia: competencia && /^\d{4}-\d{2}-\d{2}$/.test(competencia) ? competencia : null,
    });
    if (error) throw error;

    let linhas = (data ?? []) as LinhaVisaoConta[];
    if (ativo === "true") linhas = linhas.filter((l) => l.conta_ativo && l.grupo_ativo);
    if (ativo === "false") linhas = linhas.filter((l) => !l.conta_ativo);

    return NextResponse.json({ items: linhas.map(mapearConta) });
  } catch (error) {
    console.error("[/api/tipos/planos-de-conta GET]", error);
    return NextResponse.json(
      { error: mensagemDoErro(error, "Erro ao carregar planos de conta") },
      { status: statusDoErro(error) },
    );
  }
}

/**
 * POST /api/tipos/planos-de-conta
 *
 * Grava conta, exceção de classificação e regra de vigência numa transação só,
 * pela RPC. Três chamadas separadas poderiam deixar o cadastro dizendo uma coisa
 * e o histórico outra — e é o histórico que resolve uma competência passada.
 */
export async function POST(req: NextRequest) {
  try {
    await requirePerm(tipoPermission("planos_conta", "criar"));

    const body = await req.json().catch(() => ({}));
    const nome = String(body.nome ?? "").trim();
    const grupoId = Number(body.grupo_id);

    if (!nome) {
      return NextResponse.json({ error: "Nome do plano de conta é obrigatório." }, { status: 400 });
    }
    if (!Number.isInteger(grupoId) || grupoId <= 0) {
      return NextResponse.json({ error: "Grupo do plano de conta é obrigatório." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc("plano_contas_salvar_conta", {
      p_id: null,
      p_codigo: body.codigo ?? null,
      p_nome: nome,
      p_descricao: body.descricao ?? null,
      p_ativo: typeof body.ativo === "boolean" ? body.ativo : true,
      p_grupo_id: grupoId,
      p_classificacao_id: body.classificacao_id ? Number(body.classificacao_id) : null,
      p_versao_esperada: null,
      p_vigencia_inicio: body.vigencia_inicio ?? null,
      p_usuario: null,
      p_justificativa: body.justificativa ?? null,
    });
    if (error) throw error;

    const id = Number((data as { id?: number } | null)?.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Falha ao criar plano de conta." }, { status: 500 });
    }

    const { data: visao, error: erroVisao } = await supabaseAdmin.rpc("plano_contas_visao", {
      p_competencia: null,
    });
    if (erroVisao) throw erroVisao;

    const linha = ((visao ?? []) as LinhaVisaoConta[]).find((l) => Number(l.conta_id) === id);
    if (!linha) {
      return NextResponse.json({ error: "Plano de conta criado, mas não foi possível relê-lo." }, { status: 500 });
    }

    return NextResponse.json({ item: mapearConta(linha) }, { status: 201 });
  } catch (error) {
    console.error("[/api/tipos/planos-de-conta POST]", error);
    return NextResponse.json(
      { error: mensagemDoErro(error, "Erro ao cadastrar plano de conta") },
      { status: statusDoErro(error) },
    );
  }
}
