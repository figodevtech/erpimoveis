// src/app/api/pagamentos/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Params = { params: Promise<{ id: string }> };

/** Lê e valida o :id da rota */
async function parseId(ctx: Params) {
  const { id: idParam } = await ctx.params;
  const id = Number((idParam ?? "").trim());
  if (!id) throw new Error("ID inválido.");
  return id;
}

export async function GET(_req: NextRequest, ctx: Params) {
  try {
    const id = await parseId(ctx);

    // Busca pagamento principal
    const { data: pagamento, error: errPag } = await supabaseAdmin
      .from("pagamento")
      .select(
        `
        id,
        ordemservicoid,
        metodo,
        valor,
        status,
        provider_tx_id,
        nsu,
        autorizacao,
        bandeira,
        parcelas,
        comprovante,
        criado_em,
        atualizado_em,
        financeiro_pendente,
        financeiro_erro
      `
      )
      .eq("id", id)
      .maybeSingle();

    if (errPag) {
      console.error("Erro ao buscar pagamento:", errPag);
      return NextResponse.json(
        { erro: "Erro ao buscar pagamento." },
        { status: 500 }
      );
    }

    if (!pagamento) {
      return NextResponse.json(
        { erro: "Pagamento não encontrado." },
        { status: 404 }
      );
    }

    // Eventos de log vinculados a este pagamento
    const { data: eventos, error: errEvt } = await supabaseAdmin
      .from("pagamento_evento")
      .select("id, tipo, payload, criado_em")
      .eq("pagamentoid", id)
      .order("criado_em", { ascending: true });

    if (errEvt) {
      console.error("Erro ao buscar eventos de pagamento:", errEvt);
    }

    return NextResponse.json({
      pagamento,
      eventos: eventos ?? [],
    });
  } catch (e: any) {
    console.error("Erro em GET /api/pagamentos/[id]:", e);
    const msg = e?.message ?? "Erro ao carregar pagamento.";
    const status = msg.includes("ID inválido") ? 400 : 500;
    return NextResponse.json({ erro: msg }, { status });
  }
}
