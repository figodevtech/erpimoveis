import { NextRequest, NextResponse } from "next/server";
import { requireConfigAccess, requireConfigEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";
import { grupoUsoConsumoSchema, zodMessage } from "@/lib/usoconsumo/schemas";

export async function GET() {
  try {
    await requireConfigAccess();
    const { data, error } = await supabaseAdmin.from("usoconsumo_grupo").select("*").order("nome");
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    return usoConsumoError(error, "Erro ao listar grupos de uso/consumo.");
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireConfigEdit();
    const parsed = grupoUsoConsumoSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 });
    const { data, error } = await supabaseAdmin.from("usoconsumo_grupo").insert(parsed.data).select().single();
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return usoConsumoError(error, "Erro ao criar grupo de uso/consumo.");
  }
}
