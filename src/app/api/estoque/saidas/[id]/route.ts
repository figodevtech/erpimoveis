export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import { anexarAutor } from "@/lib/movement-authors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Params = { params: Promise<{ id: string }> };

const SELECT_SAIDA = `
  id, motivo, observacao, status, created_by, created_at,
  cancelada_at, cancelada_by, motivo_cancelamento,
  itens:estoque_saida_item(
    id, produto_id, quantidade, saldo_anterior, saldo_resultante,
    valor_custo_aplicado, created_at,
    produto:produto_id(id, titulo, referencia, unidade, codigobarras)
  )
`;

export async function GET(_req: Request, { params }: Params) {
  try {
    await requireEstoqueAccess();
    const { id } = await params;
    if (!/^\d+$/.test(id) || Number(id) <= 0) {
      return NextResponse.json({ error: "Saída inválida." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("estoque_saida")
      .select(SELECT_SAIDA)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Saída não encontrada." }, { status: 404 });

    return NextResponse.json({
      data: await anexarAutor({
        ...data,
        itens: Array.isArray(data.itens) ? [...data.itens].sort((a, b) => Number(a.id) - Number(b.id)) : [],
      }),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Erro ao consultar a saída." },
      { status: error?.statusCode ?? 500 },
    );
  }
}
