import { NextResponse } from "next/server";
import { requireEstoqueEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  try {
    await requireEstoqueEdit();
    const { id } = await params;
    if (!/^\d+$/.test(id) || Number(id) <= 0) {
      return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.rpc("cancelar_entrada_confirmada", {
      p_entrada_id: Number(id),
    });
    if (error) throw error;
    return NextResponse.json({ success: true, entrada: data });
  } catch (error: any) {
    const message = error?.message ?? "Não foi possível cancelar a entrada.";
    const status = error?.statusCode ?? (error?.code === "P0002" ? 404 : error?.code === "22023" ? 409 : 500);
    return NextResponse.json({ error: message }, { status });
  }
}
