export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireFinanceiroDelete, requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { exigirLeituraDeTransacao } from "@/app/api/transaction/_lib/autoria";
import { exigirAcessoAPagamentoMultiplo } from "@/app/api/transaction/_lib/autoria-afetadas";

type Params = { params: Promise<{ id: string }> };

async function lerId(params: Params["params"]) {
  const id = Number((await params).id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Detalhe do grupo: usado pelo painel do documento e pela verificação de exclusão. */
export async function GET(_: Request, { params }: Params) {
  try {
    await requireFinanceirosAccess();
    const id = await lerId(params);
    if (id == null) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    const [grupo, linhas] = await Promise.all([
      supabaseAdmin
        .from("pagamento_multiplo")
        .select("id, descricao, modo, tipo_documento, valor_total, data, metodopagamento, banco:banco_id ( id, titulo )")
        .eq("id", id)
        .maybeSingle(),
      supabaseAdmin
        .from("transacao")
        .select("id, descricao, valor, data, pendente, pago_em, ordemservicoid, vendaid")
        .eq("pagamento_multiplo_id", id)
        .eq("is_deleted", false)
        .order("id", { ascending: true }),
    ]);

    if (grupo.error) throw grupo.error;
    if (!grupo.data) {
      return NextResponse.json({ error: "Pagamento múltiplo não encontrado." }, { status: 404 });
    }
    if (linhas.error) throw linhas.error;
    await exigirLeituraDeTransacao((linhas.data ?? []).map((linha) => Number(linha.id)));

    const documentos = [
      ...new Set(
        (linhas.data ?? []).map((linha: any) =>
          Number(linha.ordemservicoid ?? linha.vendaid),
        ),
      ),
    ];

    return NextResponse.json({
      data: {
        ...grupo.data,
        documentos,
        linhas: linhas.data ?? [],
        quantidadeBaixada: (linhas.data ?? []).filter((linha: any) => linha.pendente === false)
          .length,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Erro ao carregar o pagamento múltiplo." },
      { status: Number(error?.statusCode) || 500 },
    );
  }
}

export async function DELETE(_: Request, { params }: Params) {
  try {
    await requireFinanceiroDelete();
    const id = await lerId(params);
    if (id == null) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    await exigirAcessoAPagamentoMultiplo(id);
    const session = await auth().catch(() => null);
    const deletedBy = (session?.user as { id?: string } | undefined)?.id ?? null;

    const { data, error } = await supabaseAdmin.rpc("excluir_pagamento_multiplo", {
      p_id: id,
      p_deleted_by: deletedBy,
    });

    if (error) {
      // P0001 aqui é a trava de parcela já baixada — pedido inválido, não erro nosso.
      const status = error.code === "P0001" ? 409 : error.code === "P0002" ? 404 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Erro ao excluir o pagamento múltiplo." },
      { status: Number(error?.statusCode) || 500 },
    );
  }
}
