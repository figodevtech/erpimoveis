export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  SELECT_COM_FAIXAS,
  ensureAuth,
  mapBandeira,
  mensagemAmigavel,
  parseId,
  regravarFaixas,
  statusDoErro,
  validarFaixas,
} from "../_lib";

/**
 * Edicao de uma bandeira.
 *
 * A conta e a forma de pagamento SAO editaveis, ao contrario do `codigo` de
 * tipos_entrada: nada foi gravado em outro lugar a partir delas. A transacao
 * guarda `bandeira_id` e o percentual congelado, entao corrigir aqui a conta de
 * uma bandeira cadastrada errada nao mexe em lancamento nenhum ja feito.
 *
 * As faixas idem: mudar a tabela vale dali para a frente. O historico esta
 * protegido por `transacao.bandeira_taxa_percentual`.
 */
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureAuth();

    const { id: idBruto } = await context.params;
    const id = parseId(idBruto);
    if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    const body = await req.json().catch(() => ({}));

    const nome = String(body.nome ?? "").trim();
    if (!nome) {
      return NextResponse.json({ error: "Nome da bandeira é obrigatório." }, { status: 400 });
    }

    const bancoId = Number(body.bancoId ?? body.banco_id);
    if (!Number.isInteger(bancoId) || bancoId <= 0) {
      return NextResponse.json({ error: "Selecione a conta bancária." }, { status: 400 });
    }

    const metodo = String(body.metodoPagamento ?? body.metodopagamento ?? "")
      .trim()
      .toUpperCase();
    if (!metodo) {
      return NextResponse.json({ error: "Selecione a forma de pagamento." }, { status: 400 });
    }

    const faixas = validarFaixas(body.parcelas);
    if (!faixas.ok) {
      return NextResponse.json({ error: faixas.erro }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("bandeira_cartao")
      .update({
        nome,
        descricao: String(body.descricao ?? "").trim() || null,
        banco_id: bancoId,
        metodopagamento: metodo,
        ativo: typeof body.ativo === "boolean" ? body.ativo : true,
        updatedat: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Bandeira não encontrada." }, { status: 404 });
    }

    await regravarFaixas(id, faixas.faixas);

    const { data: atualizada, error: erroAoReler } = await supabaseAdmin
      .from("bandeira_cartao")
      .select(SELECT_COM_FAIXAS)
      .eq("id", id)
      .maybeSingle();

    if (erroAoReler) throw erroAoReler;

    return NextResponse.json({ item: atualizada ? mapBandeira(atualizada) : null });
  } catch (error: any) {
    console.error("[/api/tipos/bandeiras/[id] PUT] error:", error);
    const mensagem = String(error?.message ?? "");
    return NextResponse.json(
      { error: mensagemAmigavel(mensagem, "Erro ao atualizar a bandeira.") },
      { status: statusDoErro(mensagem) },
    );
  }
}

/**
 * Apagar de vez, nao desativar.
 *
 * A desativacao ja existe pela chave "ativo" e e o caminho normal: bandeira
 * inativa some do seletor e os lancamentos antigos continuam apontando para ela.
 * O DELETE e para quem cadastrou errado e quer limpar. A FK da transacao e
 * `ON DELETE SET NULL`, entao o lancamento nao vai junto — mas perde a
 * referencia, e por isso a rota recusa quando ha transacao apontando.
 */
export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureAuth();

    const { id: idBruto } = await context.params;
    const id = parseId(idBruto);
    if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    const { count, error: erroAoContar } = await supabaseAdmin
      .from("transacao")
      .select("id", { count: "exact", head: true })
      .eq("bandeira_id", id);

    if (erroAoContar) throw erroAoContar;

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error: `Esta bandeira já foi usada em ${count} lançamento(s). Desative-a em vez de excluir, para o histórico continuar identificado.`,
        },
        { status: 409 },
      );
    }

    const { error } = await supabaseAdmin.from("bandeira_cartao").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[/api/tipos/bandeiras/[id] DELETE] error:", error);
    const mensagem = String(error?.message ?? "");
    return NextResponse.json(
      { error: mensagemAmigavel(mensagem, "Erro ao excluir a bandeira.") },
      { status: statusDoErro(mensagem) },
    );
  }
}
