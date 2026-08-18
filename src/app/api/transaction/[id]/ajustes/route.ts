export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireFinanceiroEdit, requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { respostaSeEdicaoBloqueada } from "@/app/api/transaction/_lib/edicao";
import { sincronizarTaxaRecebimento } from "@/app/api/transaction/_lib/taxa";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Params = { params: Promise<{ id: string }> };

/**
 * Acrescimos e descontos de uma transacao.
 *
 * As linhas vivem em `transacao_ajuste`; quem recalcula `valor`,
 * `valor_acrescimos`, `valor_descontos` e `valorLiquido` no pai e o gatilho
 * `transacao_ajuste_recalcular_trg`. Esta rota nao faz conta de dinheiro nenhuma
 * — se fizesse, haveria duas verdades sobre o mesmo numero.
 *
 * A unica conta aqui e converter percentual em reais, e ela precisa acontecer
 * antes do INSERT porque `valor_calculado` e coluna comum, nao gerada: o
 * percentual incide sobre `valor_base`, e so o servidor sabe qual e a base
 * corrente no momento do lancamento.
 */

const emCentavos = (valor: number) => Math.round(valor * 100);

/*
 * O que a tela precisa para redesenhar a composição do valor sem recarregar.
 *
 * `valorLiquido` faltava aqui, e era o campo que a aba mais mostra — "Entra na
 * conta". Sem ele na resposta, `aplicarTotais` caía no valor anterior e o número
 * ficava congelado: lançar ou remover um acréscimo mexia no bruto, na face e nos
 * totais de ajuste, e só o líquido não acompanhava.
 */
async function carregarTransacao(id: string) {
  const { data, error } = await supabaseAdmin
    .from("transacao")
    .select(
      'id, valor, "valorLiquido", valor_base, valor_acrescimos, valor_descontos, pendente',
    )
    .eq("id", id)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function parseId(valor: string) {
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("ID inválido.");
  return id;
}

/** Lista as linhas de ajuste, com o nome do tipo para a tela. */
export async function GET(_: NextRequest, ctx: Params) {
  try {
    await requireFinanceirosAccess();
    const id = parseId((await ctx.params).id);

    const { data, error } = await supabaseAdmin
      .from("transacao_ajuste")
      .select(
        "id, natureza, modo, valor_informado, valor_calculado, observacao, created_at, tipo:tipos_ajuste_transacao!transacao_ajuste_tipo_id_fkey ( id, codigo, nome, codigo_sistema )",
      )
      .eq("transacao_id", id)
      .order("id", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ data: data ?? [] });
  } catch (error: unknown) {
    return respostaDeErro(error);
  }
}

export async function POST(req: NextRequest, ctx: Params) {
  try {
    await requireFinanceiroEdit();

    const bloqueio = await respostaSeEdicaoBloqueada();
    if (bloqueio) return bloqueio;

    const id = parseId((await ctx.params).id);
    const body = await req.json().catch(() => ({}));

    const tipoId = Number(body?.tipoId);
    const modo = String(body?.modo ?? "").toUpperCase();
    const valorInformado = Number(body?.valorInformado);

    if (!Number.isSafeInteger(tipoId) || tipoId <= 0) {
      return NextResponse.json({ error: "Informe o tipo do ajuste." }, { status: 400 });
    }
    if (modo !== "FIXO" && modo !== "PORCENTAGEM") {
      return NextResponse.json(
        { error: "O modo deve ser FIXO ou PORCENTAGEM." },
        { status: 400 },
      );
    }
    if (!Number.isFinite(valorInformado) || valorInformado <= 0) {
      return NextResponse.json(
        { error: "O valor do ajuste deve ser maior que zero." },
        { status: 400 },
      );
    }
    if (modo === "PORCENTAGEM" && valorInformado > 100) {
      return NextResponse.json(
        { error: "O percentual não pode passar de 100%." },
        { status: 400 },
      );
    }

    const transacao = await carregarTransacao(String(id));
    if (!transacao) {
      return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
    }

    const { data: tipo, error: tipoError } = await supabaseAdmin
      .from("tipos_ajuste_transacao")
      .select("id, natureza, ativo")
      .eq("id", tipoId)
      .maybeSingle();

    if (tipoError) throw tipoError;
    if (!tipo || tipo.ativo !== true) {
      return NextResponse.json(
        { error: "Tipo de ajuste inválido ou inativo." },
        { status: 400 },
      );
    }

    // Percentual sempre sobre a base, nunca sobre o acumulado: duas linhas de
    // 10% somam 20% da base, que e o que o usuario le na tela.
    const base = Number(transacao.valor_base ?? transacao.valor ?? 0);
    const calculado =
      modo === "PORCENTAGEM"
        ? Math.round(base * valorInformado) / 100
        : Math.round(valorInformado * 100) / 100;

    if (emCentavos(calculado) <= 0) {
      return NextResponse.json(
        { error: "O ajuste calculado ficou em zero." },
        { status: 400 },
      );
    }

    const session = await auth().catch(() => null);

    const { data, error } = await supabaseAdmin
      .from("transacao_ajuste")
      .insert({
        transacao_id: id,
        tipo_id: tipoId,
        natureza: tipo.natureza,
        modo,
        valor_informado: valorInformado,
        valor_calculado: calculado,
        observacao: body?.observacao ? String(body.observacao).slice(0, 500) : null,
        created_by: (session?.user as { id?: string } | undefined)?.id ?? null,
      })
      .select("id")
      .single();

    // As regras de verdade estao no banco (acrescimo em transacao baixada,
    // natureza incoerente com o tipo, desconto acima do bruto). Traduzir o
    // ERRCODE preserva a mensagem que o gatilho escreveu.
    if (error) return respostaDeErroDoBanco(error);

    const atualizada = await carregarTransacao(String(id));
    return NextResponse.json({ data: { id: data.id, transacao: atualizada } }, { status: 201 });
  } catch (error: unknown) {
    return respostaDeErro(error);
  }
}

/**
 * Sincroniza a linha de taxa de recebimento a partir do liquido desejado.
 *
 * O campo "Liquido recebido" da aba Detalhes e o switch do cadastro pensam em
 * liquido, nao em taxa. Traduzir isso em criar, atualizar ou remover a linha e
 * trabalho de servidor: se a tela fizesse as tres chamadas, uma falha no meio
 * deixaria o lancamento com taxa pela metade.
 *
 * So aceita quando a taxa e o unico desconto. Havendo outros, nao da para saber
 * qual deles o usuario quis mexer, e chutar transformaria desconto comercial em
 * taxa de maquineta — a confusao que as linhas nomeadas vieram acabar.
 */
export async function PUT(req: NextRequest, ctx: Params) {
  try {
    await requireFinanceiroEdit();

    const bloqueio = await respostaSeEdicaoBloqueada();
    if (bloqueio) return bloqueio;

    const id = parseId((await ctx.params).id);
    const body = await req.json().catch(() => ({}));
    const liquidoDesejado = Number(body?.liquidoDesejado);

    if (!Number.isFinite(liquidoDesejado) || liquidoDesejado <= 0) {
      return NextResponse.json(
        { error: "O valor líquido deve ser maior que zero." },
        { status: 400 },
      );
    }

    const session = await auth().catch(() => null);
    const resultado = await sincronizarTaxaRecebimento(
      id,
      liquidoDesejado,
      (session?.user as { id?: string } | undefined)?.id ?? null,
    );

    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.erro }, { status: resultado.status });
    }

    return NextResponse.json({ data: { transacao: await carregarTransacao(String(id)) } });
  } catch (error: unknown) {
    return respostaDeErro(error);
  }
}

export async function DELETE(req: NextRequest, ctx: Params) {
  try {
    await requireFinanceiroEdit();

    const bloqueio = await respostaSeEdicaoBloqueada();
    if (bloqueio) return bloqueio;

    const id = parseId((await ctx.params).id);
    const ajusteId = Number(new URL(req.url).searchParams.get("ajusteId"));

    if (!Number.isSafeInteger(ajusteId) || ajusteId <= 0) {
      return NextResponse.json({ error: "Informe o ajuste a remover." }, { status: 400 });
    }

    // Remover um acrescimo baixa o bruto, e bruto de transacao baixada e
    // imutavel — a mesma razao pela qual lancar acrescimo la e recusado.
    const { data: ajuste, error: buscaError } = await supabaseAdmin
      .from("transacao_ajuste")
      .select("id, natureza, transacao:transacao_id ( pendente )")
      .eq("id", ajusteId)
      .eq("transacao_id", id)
      .maybeSingle();

    if (buscaError) throw buscaError;
    if (!ajuste) {
      return NextResponse.json({ error: "Ajuste não encontrado." }, { status: 404 });
    }

    const pendente = (ajuste.transacao as unknown as { pendente?: boolean } | null)?.pendente;
    if (ajuste.natureza === "ACRESCIMO" && pendente !== true) {
      return NextResponse.json(
        {
          error:
            "Não dá para remover acréscimo de transação já baixada, porque ele altera o valor bruto.",
        },
        { status: 400 },
      );
    }

    const { error } = await supabaseAdmin
      .from("transacao_ajuste")
      .delete()
      .eq("id", ajusteId)
      .eq("transacao_id", id);

    if (error) return respostaDeErroDoBanco(error);

    const atualizada = await carregarTransacao(String(id));
    return NextResponse.json({ data: { transacao: atualizada } });
  } catch (error: unknown) {
    return respostaDeErro(error);
  }
}

function respostaDeErroDoBanco(error: { code?: string; message?: string }) {
  if (error.code === "22023" || error.code === "23514") {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error.code === "P0002") {
    return NextResponse.json({ error: "Tipo de ajuste não encontrado." }, { status: 404 });
  }
  throw error;
}

function respostaDeErro(error: unknown) {
  const erro = error as { statusCode?: number; message?: string };
  const statusAutorizacao = Number(erro?.statusCode);
  const status =
    statusAutorizacao === 401 || statusAutorizacao === 403 ? statusAutorizacao : 400;

  return NextResponse.json(
    { error: erro?.message ?? "Não foi possível registrar o ajuste." },
    { status },
  );
}
