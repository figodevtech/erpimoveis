import { NextResponse } from "next/server";
import { requireEstoqueEdit, requireUsoConsumoCancelar } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/** Cancela de uma vez as duas entradas geradas por uma mesma NF-e. */
export async function POST(req: Request) {
  try {
    // O cancelamento mexe nos dois estoques, entao exige as duas permissoes.
    await requireEstoqueEdit();
    await requireUsoConsumoCancelar();

    const body = await req.json().catch(() => ({}));
    const entradaId = Number(body?.entradaId);
    const usoconsumoEntradaId = Number(body?.usoconsumoEntradaId);
    const motivo = String(body?.motivo ?? "").trim();

    if (!Number.isInteger(entradaId) || entradaId <= 0) {
      return NextResponse.json({ error: "Entrada de estoque inválida." }, { status: 400 });
    }
    if (!Number.isInteger(usoconsumoEntradaId) || usoconsumoEntradaId <= 0) {
      return NextResponse.json({ error: "Entrada de uso e consumo inválida." }, { status: 400 });
    }
    if (!motivo) {
      return NextResponse.json({ error: "Informe o motivo do cancelamento." }, { status: 400 });
    }

    const session = await auth();
    const { data, error } = await supabaseAdmin.rpc("cancelar_entrada_fiscal_mista", {
      p_entrada_id: entradaId,
      p_usoconsumo_entrada_id: usoconsumoEntradaId,
      p_motivo: motivo,
      p_cancelada_by: (session?.user as { id?: string })?.id ?? null,
    });
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    const status = error?.statusCode
      ?? (error?.code === "P0002" ? 404 : error?.code === "22023" ? 409 : 500);
    return NextResponse.json(
      { error: error?.message ?? "Não foi possível cancelar a entrada." },
      { status },
    );
  }
}
