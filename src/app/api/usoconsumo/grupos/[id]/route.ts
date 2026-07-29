import { NextRequest, NextResponse } from "next/server";
import { requireUsoConsumoEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";
import { grupoUsoConsumoSchema, zodMessage } from "@/lib/usoconsumo/schemas";

type Context = { params: Promise<{ id: string }> };
async function idOf(context: Context) { const id = Number((await context.params).id); if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error("Grupo inválido."), { statusCode: 400 }); return id; }

export async function PATCH(req: NextRequest, context: Context) {
  try {
    await requireUsoConsumoEdit();
    const parsed = grupoUsoConsumoSchema.partial().safeParse(await req.json());
    if (!parsed.success || !Object.keys(parsed.data).length) return NextResponse.json({ error: parsed.success ? "Nada para atualizar." : zodMessage(parsed.error) }, { status: 400 });
    const { data, error } = await supabaseAdmin.from("usoconsumo_grupo").update({ ...parsed.data, updated_at: new Date().toISOString() }).eq("id", await idOf(context)).select().maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Grupo não encontrado." }, { status: 404 });
    return NextResponse.json({ data });
  } catch (error) { return usoConsumoError(error, "Erro ao editar grupo."); }
}

export async function DELETE(_req: NextRequest, context: Context) {
  try {
    await requireUsoConsumoEdit();
    const { data, error } = await supabaseAdmin.from("usoconsumo_grupo").update({ ativo: false, updated_at: new Date().toISOString() }).eq("id", await idOf(context)).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Grupo não encontrado." }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (error) { return usoConsumoError(error, "Erro ao inativar grupo."); }
}

