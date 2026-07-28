export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireEstoqueEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const MOTIVOS = new Set([
  "USO_INTERNO",
  "AVARIA",
  "PERDA",
  "FURTO",
  "VENCIMENTO",
  "DOACAO",
  "TRANSFERENCIA",
  "AJUSTE_INVENTARIO",
  "OUTRO",
]);

export async function POST(req: NextRequest) {
  try {
    await requireEstoqueEdit();
    const session = await auth();
    const body = await req.json();
    const produtoId = Number(body?.produtoId);
    const quantidade = Number(body?.quantidade);
    const motivo = String(body?.motivo ?? "").trim().toUpperCase();
    const observacao = String(body?.observacao ?? "").trim() || null;

    if (!Number.isInteger(produtoId) || produtoId <= 0) {
      return NextResponse.json({ error: "Produto inválido." }, { status: 400 });
    }
    if (!Number.isInteger(quantidade) || quantidade <= 0) {
      return NextResponse.json({ error: "Informe uma quantidade inteira maior que zero." }, { status: 400 });
    }
    if (!MOTIVOS.has(motivo)) {
      return NextResponse.json({ error: "Selecione um motivo válido." }, { status: 400 });
    }
    if (motivo === "OUTRO" && !observacao) {
      return NextResponse.json({ error: "Informe a observação para o motivo Outro." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc("registrar_saida_estoque", {
      p_produto_id: produtoId,
      p_quantidade: quantidade,
      p_motivo: motivo,
      p_observacao: observacao,
      p_created_by: (session?.user as any)?.id ?? null,
    });
    if (error) throw error;

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error: any) {
    const message = error?.message ?? "Não foi possível registrar a saída.";
    const status = error?.statusCode ?? (message.includes("Estoque insuficiente") ? 409 : 500);
    return NextResponse.json({ error: message }, { status });
  }
}
