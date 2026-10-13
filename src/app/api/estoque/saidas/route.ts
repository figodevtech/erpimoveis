export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireEstoqueAccess, requireEstoqueEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { MOTIVO_SAIDA_ALUGUEL } from "@/lib/alugueis/status";

async function motivoValidoParaProduto(motivo: string) {
  const { data } = await supabaseAdmin
    .from("tipos_motivo_saida")
    .select("id")
    .eq("codigo", motivo)
    .eq("ativo", true)
    .in("escopo", ["PRODUTO", "AMBOS"])
    .maybeSingle();
  return Boolean(data);
}

export async function GET(req: NextRequest) {
  try {
    await requireEstoqueAccess();
    const page = Math.max(Number(req.nextUrl.searchParams.get("page")) || 1, 1);
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 20, 1), 100);
    const from = (page - 1) * limit;

    const { data, error, count } = await supabaseAdmin
      .from("estoque_saida")
      .select(
        "*, itens:estoque_saida_item(*, produto:produto_id(id,titulo,referencia,unidade))",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);

    if (error) throw error;
    const total = count ?? 0;
    return NextResponse.json({
      data: data ?? [],
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error: any) {
    const message = error?.message ?? "Não foi possível carregar as saídas.";
    return NextResponse.json({ error: message }, { status: error?.statusCode ?? 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireEstoqueEdit();
    const session = await auth();
    const body = await req.json();
    const produtoId = Number(body?.produtoId);
    const quantidade = Number(body?.quantidade);
    const motivo = String(body?.motivo ?? "").trim().toUpperCase();
    const observacao = String(body?.descricao ?? body?.observacao ?? "").trim() || null;

    if (!Number.isInteger(produtoId) || produtoId <= 0) {
      return NextResponse.json({ error: "Produto inválido." }, { status: 400 });
    }
    if (!Number.isInteger(quantidade) || quantidade <= 0) {
      return NextResponse.json({ error: "Informe uma quantidade inteira maior que zero." }, { status: 400 });
    }
    if (motivo === MOTIVO_SAIDA_ALUGUEL) {
      return NextResponse.json({ error: "A saída por aluguel é registrada pelo módulo Aluguéis." }, { status: 400 });
    }
    if (!(await motivoValidoParaProduto(motivo))) {
      return NextResponse.json({ error: "Selecione um motivo válido." }, { status: 400 });
    }
    if (motivo === "OUTRO" && !observacao) {
      return NextResponse.json({ error: "Informe a descrição para o motivo Outro." }, { status: 400 });
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
