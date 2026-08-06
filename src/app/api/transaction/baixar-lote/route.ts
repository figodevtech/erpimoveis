export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireFinanceiroEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Baixa de várias transações pendentes de uma vez.
 *
 * Cada linha passa pela mesma RPC da baixa individual
 * (`baixar_transacao_pendente`), que grava `pago_em`, autor, histórico em
 * `transacao_baixa_historico` e revalida o status da OS ou venda. Reimplementar
 * isso em lote criaria uma segunda verdade sobre o que é dar baixa.
 *
 * NÃO É TUDO OU NADA, de propósito. Cada baixa é atômica em si; o lote é uma
 * sequência delas. Uma linha que falhe — já baixada por outra pessoa, banco
 * inválido — não desfaz as que deram certo, porque desfazer significaria
 * estornar pagamento já registrado. A resposta diz exatamente o que passou e o
 * que não passou, e a tela mostra as duas listas.
 */

const LIMITE = 200;

export async function POST(req: NextRequest) {
  try {
    await requireFinanceiroEdit();

    const body = await req.json().catch(() => ({}));
    const ids: unknown = body?.ids;
    const dataPagamento = String(body?.dataPagamento ?? "");
    const bancoId = Number(body?.bancoId);
    const metodoPagamento = String(body?.metodoPagamento ?? "");

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "Selecione ao menos uma transação." },
        { status: 400 },
      );
    }
    if (ids.length > LIMITE) {
      return NextResponse.json(
        { error: `Baixe no máximo ${LIMITE} transações por vez.` },
        { status: 400 },
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataPagamento)) {
      return NextResponse.json({ error: "Informe uma data de pagamento válida." }, { status: 400 });
    }
    if (!Number.isSafeInteger(bancoId) || bancoId <= 0 || !metodoPagamento) {
      return NextResponse.json(
        { error: "Banco e método de pagamento são obrigatórios." },
        { status: 400 },
      );
    }

    const limpos = [
      ...new Set(
        ids
          .map((id) => Number(id))
          .filter((id) => Number.isSafeInteger(id) && id > 0),
      ),
    ];

    if (limpos.length === 0) {
      return NextResponse.json({ error: "Nenhuma transação válida." }, { status: 400 });
    }

    // Meio-dia no fuso do Brasil: a data chega como dia puro e precisa cair no
    // dia certo depois da conversão para UTC, mesma regra da baixa individual.
    const pagoEm = new Date(`${dataPagamento}T12:00:00-03:00`);
    if (Number.isNaN(pagoEm.getTime())) {
      return NextResponse.json({ error: "Informe uma data de pagamento válida." }, { status: 400 });
    }

    const session = await auth().catch(() => null);
    const baixadoPor = (session?.user as { id?: string } | undefined)?.id ?? null;

    const baixados: number[] = [];
    const falhas: Array<{ id: number; erro: string }> = [];

    for (const id of limpos) {
      const { error } = await supabaseAdmin.rpc("baixar_transacao_pendente", {
        p_transacao_id: id,
        p_pago_em: pagoEm.toISOString(),
        p_banco_id: bancoId,
        p_metodopagamento: metodoPagamento,
        p_plano_de_conta_id: null,
        p_centro_custo_id: null,
        p_baixado_por: baixadoPor,
      });

      if (!error) {
        baixados.push(id);
        continue;
      }

      falhas.push({ id, erro: traduzir(error) });
    }

    return NextResponse.json({ data: { baixados, falhas } });
  } catch (error: unknown) {
    const erro = error as { statusCode?: number; message?: string };
    const status = Number(erro?.statusCode);
    return NextResponse.json(
      { error: erro?.message ?? "Não foi possível dar baixa." },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}

function traduzir(error: { code?: string; message?: string }) {
  if (error.code === "23505" || (error.message ?? "").includes("ja foi baixada")) {
    return "Já estava baixada.";
  }
  if (error.code === "P0002") return "Não encontrada.";
  if (error.code === "23503") return "Banco inválido.";
  if (error.code === "22023") return error.message ?? "Dados inválidos.";
  return error.message ?? "Erro inesperado.";
}
