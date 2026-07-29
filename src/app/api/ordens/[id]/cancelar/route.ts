// ./src/app/api/ordens/[id]/cancelar/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { requireOSEdit } from "@/app/api/_authz/perms";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireOSEdit();
    const { id } = await ctx.params;
    const osId = Number(id);
    if (!Number.isFinite(osId) || osId <= 0) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({} as any));
    const motivo = String(body?.motivo ?? "").trim();

    if (!motivo) {
      return NextResponse.json({ error: "Motivo do cancelamento é obrigatório." }, { status: 400 });
    }

    const { error } = await supabase
      .from("ordemservico")
      .update({
        status: "CANCELADO",
        motivo_cancelamento: motivo,
      })
      .eq("id", osId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erro inesperado" }, { status: 500 });
  }
}
