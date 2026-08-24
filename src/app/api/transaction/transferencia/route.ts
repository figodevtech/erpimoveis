export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireFinanceiroEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Transferência entre contas próprias.
 *
 * Toda a regra vive na RPC `registrar_transferencia_entre_contas`, que grava a
 * operação e as duas pernas numa transação só. Aqui é tudo ou nada pelo motivo
 * mais direto que existe: meia transferência é dinheiro evaporado — sobraria uma
 * conta com o valor saído e nenhuma com ele entrado, e a diferença só apareceria
 * semanas depois, na conciliação, sem pista de onde veio.
 */

export async function POST(req: NextRequest) {
  try {
    await requireFinanceiroEdit();

    const body = await req.json().catch(() => ({}));

    const valor = Number(body?.valor);
    const data = String(body?.data ?? "");
    const bancoOrigemId = Number(body?.bancoOrigemId);
    const bancoDestinoId = Number(body?.bancoDestinoId);
    const metodoPagamento = String(body?.metodoPagamento ?? "");

    if (!Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json(
        { error: "Informe um valor maior que zero." },
        { status: 400 },
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return NextResponse.json({ error: "Informe uma data válida." }, { status: 400 });
    }
    if (!Number.isSafeInteger(bancoOrigemId) || bancoOrigemId <= 0) {
      return NextResponse.json({ error: "Informe a conta de origem." }, { status: 400 });
    }
    if (!Number.isSafeInteger(bancoDestinoId) || bancoDestinoId <= 0) {
      return NextResponse.json({ error: "Informe a conta de destino." }, { status: 400 });
    }
    if (bancoOrigemId === bancoDestinoId) {
      return NextResponse.json(
        {
          error:
            "A conta de origem e a de destino são a mesma: não há transferência a registrar.",
        },
        { status: 400 },
      );
    }
    if (!metodoPagamento) {
      return NextResponse.json(
        { error: "Informe como o dinheiro foi movido." },
        { status: 400 },
      );
    }

    // Meio-dia no fuso do Brasil, mesma regra da baixa e do adiantamento: a data
    // chega como dia puro e precisa cair no dia certo depois da conversão.
    const quando = new Date(`${data}T12:00:00-03:00`);
    if (Number.isNaN(quando.getTime())) {
      return NextResponse.json({ error: "Informe uma data válida." }, { status: 400 });
    }

    const session = await auth().catch(() => null);

    const { data: resultado, error } = await supabaseAdmin.rpc(
      "registrar_transferencia_entre_contas",
      {
        p_valor: valor,
        p_data: quando.toISOString(),
        p_banco_origem_id: bancoOrigemId,
        p_banco_destino_id: bancoDestinoId,
        p_metodopagamento: metodoPagamento,
        p_descricao: body?.descricao ?? null,
        p_plano_de_conta_id: body?.planoContaId ?? null,
        p_centro_custo_id: body?.centroCustoId ?? null,
        p_criado_por: (session?.user as { id?: string } | undefined)?.id ?? null,
      },
    );

    if (error) {
      // A RPC já escreve mensagens prontas para quem está usando.
      if (error.code === "22023" || error.code === "23514") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === "P0002") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      if (error.code === "23503") {
        return NextResponse.json(
          { error: "Conta, plano de conta ou centro de custo inválido." },
          { status: 422 },
        );
      }
      throw error;
    }

    return NextResponse.json({ data: resultado }, { status: 201 });
  } catch (error: unknown) {
    const erro = error as { statusCode?: number; message?: string };
    const status = Number(erro?.statusCode);
    return NextResponse.json(
      { error: erro?.message ?? "Não foi possível registrar a transferência." },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}

/**
 * Os dados de uma transferência, para a faixa de origem do dialog de edição e
 * para o aviso da exclusão. Serve às duas pernas: cada uma acha a outra por aqui.
 */
export async function GET(req: NextRequest) {
  try {
    await requireFinanceiroEdit();

    const id = Number(new URL(req.url).searchParams.get("transacaoId"));
    if (!Number.isSafeInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Transação inválida." }, { status: 400 });
    }

    const { data: atual, error: atualError } = await supabaseAdmin
      .from("transacao")
      .select("id, transferencia_id")
      .eq("id", id)
      .maybeSingle();

    if (atualError) throw atualError;
    if (!atual) return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
    if (atual.transferencia_id == null) {
      return NextResponse.json({ data: null });
    }

    const [{ data: transferencia }, { data: pernas }] = await Promise.all([
      supabaseAdmin
        .from("transacao_transferencia")
        .select(
          "id, valor, data, metodopagamento, descricao, " +
            "origem:bancoconta!transacao_transferencia_banco_origem_id_fkey ( id, titulo ), " +
            "destino:bancoconta!transacao_transferencia_banco_destino_id_fkey ( id, titulo )",
        )
        .eq("id", atual.transferencia_id)
        .maybeSingle(),
      supabaseAdmin
        .from("transacao")
        .select("id, tipo, banco_id, valor")
        .eq("transferencia_id", atual.transferencia_id)
        .eq("is_deleted", false)
        .order("id", { ascending: true }),
    ]);

    const lista = pernas ?? [];
    const contraparte = lista.find((p: { id: number }) => Number(p.id) !== id) ?? null;

    return NextResponse.json({
      data: {
        transferencia,
        // Quem pergunta é sempre uma das pernas: dizer qual dos dois lados ela é
        // poupa a tela de deduzir isso do tipo.
        sentido:
          lista.find((p: { id: number }) => Number(p.id) === id)?.tipo === "RECEITA"
            ? "ENTRADA"
            : "SAIDA",
        contraparte,
      },
    });
  } catch (error: unknown) {
    const erro = error as { statusCode?: number; message?: string };
    const status = Number(erro?.statusCode);
    return NextResponse.json(
      { error: erro?.message ?? "Não foi possível carregar a transferência." },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}
