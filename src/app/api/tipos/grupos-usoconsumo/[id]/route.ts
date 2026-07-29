import { NextRequest, NextResponse } from "next/server";
import { requireConfigEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";
import { grupoUsoConsumoSchema, zodMessage } from "@/lib/usoconsumo/schemas";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    await requireConfigEdit();
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Grupo inválido." }, { status: 400 });
    const parsed = grupoUsoConsumoSchema.partial().safeParse(await req.json());
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: parsed.success ? "Nada para atualizar." : zodMessage(parsed.error) }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.from("usoconsumo_grupo")
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Grupo não encontrado." }, { status: 404 });
    return NextResponse.json({ data });
  } catch (error) {
    return usoConsumoError(error, "Erro ao editar grupo de uso/consumo.");
  }
}
