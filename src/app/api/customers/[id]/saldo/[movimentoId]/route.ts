// src/app/api/customers/[id]/saldo/[movimentoId]/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireFinanceiroEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Params = { params: Promise<{ id: string; movimentoId: string }> };

function parseId(raw: string | undefined) {
  const id = Number((raw ?? "").trim());
  if (!Number.isInteger(id) || id <= 0) throw new Error("ID inválido.");
  return id;
}

/**
 * Mesma tradução do ajuste: a RPC já devolve a mensagem pronta para recusa de
 * regra (saldo que ficaria negativo, linha que veio de baixa).
 */
function respostaDeErro(error: { code?: string; message?: string }) {
  if (error.code === "22023") {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error.code === "P0002") {
    return NextResponse.json({ error: error.message || "Lançamento não encontrado." }, { status: 404 });
  }
  return null;
}

function falha(e: any, padrao: string) {
  const msg = e?.message ?? padrao;
  const statusCode = Number(e?.statusCode);
  if (statusCode === 401 || statusCode === 403) {
    return NextResponse.json({ error: msg }, { status: statusCode });
  }
  return NextResponse.json({ error: msg }, { status: msg.includes("ID inválido") ? 400 : 500 });
}

/* ========================= PATCH ========================= */

/**
 * Corrige um ajuste manual do crédito: sentido, valor e motivo.
 *
 * A linha muda de verdade e o banco recalcula o "saldo após" de todas as
 * seguintes. Lançamento que veio de baixa não passa por aqui — desfazê-lo é
 * estornar a baixa no financeiro.
 */
export async function PATCH(req: Request, ctx: Params) {
  try {
    await requireFinanceiroEdit();
    const session = await auth();
    const { id: rawCliente, movimentoId: rawMovimento } = await ctx.params;
    const clienteId = parseId(rawCliente);
    const movimentoId = parseId(rawMovimento);

    const body = await req.json().catch(() => ({}));
    const sentido = String(body?.sentido ?? "").trim().toUpperCase();
    const valor = Number(body?.valor);
    const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : null;

    if (sentido !== "CREDITO" && sentido !== "DEBITO") {
      return NextResponse.json(
        { error: "Informe se o lançamento adiciona (CREDITO) ou remove (DEBITO) saldo." },
        { status: 400 },
      );
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json(
        { error: "O valor do lançamento deve ser maior que zero." },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin.rpc("editar_movimento_saldo_cliente", {
      p_cliente_id: clienteId,
      p_movimento_id: movimentoId,
      p_sentido: sentido,
      p_valor: valor,
      p_motivo: motivo || null,
      p_usuario: (session?.user as any)?.id ?? null,
    });

    if (error) {
      const resposta = respostaDeErro(error);
      if (resposta) return resposta;
      throw error;
    }

    return NextResponse.json({ data });
  } catch (e: any) {
    return falha(e, "Não foi possível editar o lançamento de crédito.");
  }
}

/* ========================= DELETE ========================= */

/**
 * Exclui um ajuste manual do crédito. A linha some do extrato; quem lembra
 * dela é a auditoria.
 */
export async function DELETE(_req: Request, ctx: Params) {
  try {
    await requireFinanceiroEdit();
    const session = await auth();
    const { id: rawCliente, movimentoId: rawMovimento } = await ctx.params;
    const clienteId = parseId(rawCliente);
    const movimentoId = parseId(rawMovimento);

    const { data, error } = await supabaseAdmin.rpc("excluir_movimento_saldo_cliente", {
      p_cliente_id: clienteId,
      p_movimento_id: movimentoId,
      p_usuario: (session?.user as any)?.id ?? null,
    });

    if (error) {
      const resposta = respostaDeErro(error);
      if (resposta) return resposta;
      throw error;
    }

    return NextResponse.json({ data });
  } catch (e: any) {
    return falha(e, "Não foi possível excluir o lançamento de crédito.");
  }
}
