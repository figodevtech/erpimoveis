export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireEstoqueEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { lerMotivoCancelamento } from "@/lib/cancelamento";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  try {
    await requireEstoqueEdit();
    const { id } = await params;
    if (!/^\d+$/.test(id) || Number(id) <= 0) {
      return NextResponse.json({ error: "Saída inválida." }, { status: 400 });
    }

    const motivo = await lerMotivoCancelamento(req);
    if (!motivo) {
      return NextResponse.json({ error: "Informe o motivo do cancelamento." }, { status: 400 });
    }

    const session = await auth();
    const { data, error } = await supabaseAdmin.rpc("cancelar_saida_estoque", {
      p_saida_id: Number(id),
      p_motivo: motivo,
      p_cancelada_by: (session?.user as { id?: string })?.id ?? null,
    });
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    const message = error?.message ?? "Não foi possível cancelar a saída.";
    const status = error?.statusCode ?? (error?.code === "P0002" ? 404 : error?.code === "22023" ? 409 : 500);
    return NextResponse.json({ error: message }, { status });
  }
}
