import { NextRequest, NextResponse } from "next/server";
import { requireUsoConsumoEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";
import { inventarioUsoConsumoSchema, zodMessage } from "@/lib/usoconsumo/schemas";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUsoConsumoEdit();
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Item inválido." }, { status: 400 });
    const parsed = inventarioUsoConsumoSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 });
    const session = await auth();
    const { data, error } = await supabaseAdmin.rpc("ajustar_inventario_usoconsumo", {
      p_item_id: id, p_novo_saldo: parsed.data.novo_saldo, p_observacao: parsed.data.observacao,
      p_created_by: (session?.user as { id?: string })?.id ?? null,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) { return usoConsumoError(error, "Erro ao ajustar inventário."); }
}

