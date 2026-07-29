import { NextRequest, NextResponse } from "next/server";
import { requireUsoConsumoAccess, requireUsoConsumoEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";
import { grupoUsoConsumoSchema, zodMessage } from "@/lib/usoconsumo/schemas";

export async function GET(req: NextRequest) {
  try {
    await requireUsoConsumoAccess();
    let query = supabaseAdmin.from("usoconsumo_grupo").select("*").order("nome");
    if (req.nextUrl.searchParams.get("all") !== "true") query = query.eq("ativo", true);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) { return usoConsumoError(error, "Erro ao listar grupos."); }
}

export async function POST(req: NextRequest) {
  try {
    await requireUsoConsumoEdit();
    const parsed = grupoUsoConsumoSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 });
    const { data, error } = await supabaseAdmin.from("usoconsumo_grupo").insert(parsed.data).select().single();
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) { return usoConsumoError(error, "Erro ao criar grupo."); }
}
