import { NextResponse } from "next/server";
import { requireUsoConsumoCancelar } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { lerMotivoCancelamento } from "@/lib/cancelamento";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUsoConsumoCancelar();
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });

    const motivo = await lerMotivoCancelamento(req);
    if (!motivo) return NextResponse.json({ error: "Informe o motivo do cancelamento." }, { status: 400 });

    const session = await auth();
    const { data, error } = await supabaseAdmin.rpc("cancelar_entrada_usoconsumo", {
      p_entrada_id: id,
      p_motivo: motivo,
      p_cancelada_by: (session?.user as { id?: string })?.id ?? null,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    return usoConsumoError(error, "Erro ao cancelar entrada.");
  }
}
