import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireEstoqueEdit, requireUsoConsumoEdit } from "@/app/api/_authz/perms";
import { ajusteValoresEntradaSchema } from "@/lib/estoque/entrada-valores";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { erroValoresEntrada } from "@/services/estoque/entradaValoresService";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });
    const parsed = ajusteValoresEntradaSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(" ") }, { status: 400 });
    const input = parsed.data;
    if (input.inventory === "produto") await requireEstoqueEdit();
    else await requireUsoConsumoEdit();
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const { data, error } = await supabaseAdmin.rpc("ajustar_valores_entrada", {
      p_inventory: input.inventory, p_id: id, p_itens: input.itens,
      p_motivo: input.motivo, p_versao_esperada: input.versaoEsperada, p_created_by: userId,
    });
    if (error) throw error;
    return NextResponse.json({ success: true, resultado: data });
  } catch (error) {
    const parsed = erroValoresEntrada(error as Error);
    return NextResponse.json({ error: parsed.message }, { status: parsed.status });
  }
}
