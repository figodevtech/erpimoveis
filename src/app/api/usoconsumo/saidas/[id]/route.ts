import { NextResponse } from "next/server";
import { requireUsoConsumoAccess } from "@/app/api/_authz/perms";
import { anexarAutor } from "@/lib/movement-authors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUsoConsumoAccess();
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Saída inválida." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("usoconsumo_saida")
      .select(
        "id,escopo,motivo,observacao,setor,funcionario,status,ordemservicoid,created_by,created_at,cancelada_at,cancelada_by,motivo_cancelamento," +
          "centro_custo:centrosdecusto(id,nome)," +
          "itens:usoconsumo_saida_item(id,item_id,quantidade,saldo_anterior,saldo_resultante,valor_custo_aplicado,created_at,item:usoconsumo_item(id,titulo,referencia,unidade))",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Saída não encontrada." }, { status: 404 });

    // O select aninhado quebra a inferencia de tipos do supabase-js; o formato e validado
    // pelo proprio PostgREST, entao normalizamos aqui como registro generico.
    const saida = data as Record<string, any>;
    return NextResponse.json({
      data: await anexarAutor({
        ...saida,
        itens: Array.isArray(saida.itens)
          ? [...saida.itens].sort((a, b) => Number(a.id) - Number(b.id))
          : [],
      }),
    });
  } catch (error) {
    return usoConsumoError(error, "Erro ao buscar saída.");
  }
}
