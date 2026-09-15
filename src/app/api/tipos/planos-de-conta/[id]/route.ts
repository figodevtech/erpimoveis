export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireConfigEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mensagemDoErro, statusDoErro } from "@/lib/financeiro/plano-contas/erros";
import { mapearConta, type LinhaVisaoConta } from "../_mapa";

function parseId(valor: string): number | null {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function relerConta(id: number) {
  const { data, error } = await supabaseAdmin.rpc("plano_contas_visao", { p_competencia: null });
  if (error) throw error;
  return ((data ?? []) as LinhaVisaoConta[]).find((l) => Number(l.conta_id) === id) ?? null;
}

/**
 * PUT /api/tipos/planos-de-conta/[id]
 *
 * `versao_registro` do corpo é a versão que a tela leu. Se outra pessoa salvou
 * no meio, a RPC devolve PT409 e a rota responde 409 — em vez de sobrescrever
 * calada o que o outro gravou.
 *
 * Campo omitido preserva o que está gravado — `classificacao_id` inclusive: só
 * um `null` explícito remove a linha própria. Antes, `codigo` e `descricao`
 * ausentes viravam nulos, e quem só trocava a linha da conta pela DRE apagava o
 * código e a descrição dela sem saber.
 */
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireConfigEdit();

    const { id: bruto } = await context.params;
    const id = parseId(bruto);
    if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const informou = (campo: string) => Object.prototype.hasOwnProperty.call(body, campo);

    const atual = await relerConta(id);
    if (!atual) return NextResponse.json({ error: "Plano de conta não encontrado." }, { status: 404 });

    const nome = informou("nome") ? String(body.nome ?? "").trim() : atual.conta_nome;
    const grupoId = informou("grupo_id") ? Number(body.grupo_id) : Number(atual.grupo_id);

    if (!nome) {
      return NextResponse.json({ error: "Nome do plano de conta é obrigatório." }, { status: 400 });
    }
    if (!Number.isInteger(grupoId) || grupoId <= 0) {
      return NextResponse.json({ error: "Grupo do plano de conta é obrigatório." }, { status: 400 });
    }

    const temClassificacao = informou("classificacao_id");
    let classificacaoId: number | null = null;
    if (temClassificacao) {
      classificacaoId = body.classificacao_id ? Number(body.classificacao_id) : null;
    } else if (atual.classificacao_especifica) {
      const { data } = await supabaseAdmin
        .from("classificacoes_resultado")
        .select("id")
        .eq("codigo", atual.classificacao_especifica)
        .maybeSingle();
      classificacaoId = data ? Number(data.id) : null;
    }

    const { error } = await supabaseAdmin.rpc("plano_contas_salvar_conta", {
      p_id: id,
      p_codigo: informou("codigo") ? (body.codigo ?? null) : atual.conta_codigo,
      p_nome: nome,
      p_descricao: informou("descricao") ? (body.descricao ?? null) : atual.conta_descricao,
      p_ativo: typeof body.ativo === "boolean" ? body.ativo : null,
      p_grupo_id: grupoId,
      p_classificacao_id: classificacaoId,
      p_versao_esperada: Number.isInteger(Number(body.versao_registro))
        ? Number(body.versao_registro)
        : null,
      p_vigencia_inicio: body.vigencia_inicio ?? null,
      p_usuario: null,
      p_justificativa: body.justificativa ?? null,
    });
    if (error) throw error;

    const linha = await relerConta(id);
    if (!linha) return NextResponse.json({ error: "Plano de conta não encontrado." }, { status: 404 });

    return NextResponse.json({ item: mapearConta(linha) });
  } catch (error) {
    console.error("[/api/tipos/planos-de-conta/:id PUT]", error);
    return NextResponse.json(
      { error: mensagemDoErro(error, "Erro ao atualizar plano de conta") },
      { status: statusDoErro(error) },
    );
  }
}

/** PATCH altera apenas `ativo`, passando pela mesma RPC para versionar o registro. */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireConfigEdit();

    const { id: bruto } = await context.params;
    const id = parseId(bruto);
    if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    if (typeof body.ativo !== "boolean") {
      return NextResponse.json({ error: "Campo 'ativo' deve ser boolean." }, { status: 400 });
    }

    const atual = await relerConta(id);
    if (!atual) return NextResponse.json({ error: "Plano de conta não encontrado." }, { status: 404 });

    const { data: classificacao } = atual.classificacao_especifica
      ? await supabaseAdmin
          .from("classificacoes_resultado")
          .select("id")
          .eq("codigo", atual.classificacao_especifica)
          .maybeSingle()
      : { data: null };

    const { error } = await supabaseAdmin.rpc("plano_contas_salvar_conta", {
      p_id: id,
      p_codigo: atual.conta_codigo,
      p_nome: atual.conta_nome,
      p_descricao: atual.conta_descricao,
      p_ativo: body.ativo,
      p_grupo_id: Number(atual.grupo_id),
      p_classificacao_id: classificacao ? Number(classificacao.id) : null,
      p_versao_esperada: Number.isInteger(Number(body.versao_registro))
        ? Number(body.versao_registro)
        : null,
      p_vigencia_inicio: null,
      p_usuario: null,
      p_justificativa: null,
    });
    if (error) throw error;

    const linha = await relerConta(id);
    if (!linha) return NextResponse.json({ error: "Plano de conta não encontrado." }, { status: 404 });

    return NextResponse.json({ item: mapearConta(linha) });
  } catch (error) {
    console.error("[/api/tipos/planos-de-conta/:id PATCH]", error);
    return NextResponse.json(
      { error: mensagemDoErro(error, "Erro ao atualizar status do plano de conta") },
      { status: statusDoErro(error) },
    );
  }
}

/**
 * DELETE só remove cadastro que nunca foi usado.
 *
 * A FK de `transacao.plano_de_conta_id` é ON DELETE SET NULL: apagar uma conta
 * usada não dava erro, deixava os lançamentos sem conta e sem aviso. A partir
 * daqui, o caminho para tirar uma conta de circulação é inativá-la.
 */
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireConfigEdit();

    const { id: bruto } = await context.params;
    const id = parseId(bruto);
    if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    const { data: uso, error: erroUso } = await supabaseAdmin
      .rpc("plano_contas_uso_da_conta", { p_conta_id: id })
      .maybeSingle();
    if (erroUso) throw erroUso;

    const transacoes = Number((uso as { transacoes?: number } | null)?.transacoes ?? 0);
    if (transacoes > 0) {
      return NextResponse.json(
        {
          error: `Esta conta tem ${transacoes} lançamento(s) e não pode ser excluída. Inative-a para tirá-la das listas sem perder o histórico.`,
        },
        { status: 409 },
      );
    }

    const { error } = await supabaseAdmin.from("planosdeconta").delete().eq("id", id);
    if (error) throw error;

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[/api/tipos/planos-de-conta/:id DELETE]", error);
    return NextResponse.json(
      { error: mensagemDoErro(error, "Erro ao deletar plano de conta") },
      { status: statusDoErro(error) },
    );
  }
}
