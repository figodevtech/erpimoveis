import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/app/api/_authz/perms";
import { tipoPermission } from "@/app/api/_authz/permission-constants";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";
import { grupoUsoConsumoSchema, zodMessage } from "@/lib/usoconsumo/schemas";

export async function GET() {
  try {
    await requirePerm(tipoPermission("grupos_usoconsumo", "visualizar"));
    const { data, error } = await supabaseAdmin.from("usoconsumo_grupo").select("*").order("nome");
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    return usoConsumoError(error, "Erro ao listar grupos de uso/consumo.");
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePerm(tipoPermission("grupos_usoconsumo", "criar"));
    const parsed = grupoUsoConsumoSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 });
    const { data, error } = await supabaseAdmin.from("usoconsumo_grupo").insert(parsed.data).select().single();
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return usoConsumoError(error, "Erro ao criar grupo de uso/consumo.");
  }
}
