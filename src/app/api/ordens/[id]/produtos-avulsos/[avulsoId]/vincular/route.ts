import { NextRequest, NextResponse } from "next/server";
import { requireOSEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; avulsoId: string }> },
) {
  try {
    await requireOSEdit();
    const { id, avulsoId } = await params;
    const ordemId = Number(id);
    const itemId = Number(avulsoId);
    const body = await req.json().catch(() => ({}));
    const produtoId = Number(body?.produtoId);

    if (![ordemId, itemId, produtoId].every((value) => Number.isInteger(value) && value > 0)) {
      return NextResponse.json({ error: "OS, item avulso ou produto inválido." }, { status: 400 });
    }

    const { error } = await supabaseAdmin.rpc("vincular_produto_avulso_os", {
      p_ordem_id: ordemId,
      p_avulso_id: itemId,
      p_produto_id: produtoId,
    });

    if (error) {
      const conflict = error.code === "23505" || error.code === "P0001";
      return NextResponse.json(
        { error: error.message || "Não foi possível vincular o produto avulso." },
        { status: conflict ? 409 : 400 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Não foi possível vincular o produto avulso." },
      { status: 500 },
    );
  }
}
