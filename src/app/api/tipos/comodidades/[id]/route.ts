export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { comodidadeFailure, mapComodidade, parseComodidade } from "../shared";

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Renomear não altera imóveis já cadastrados: eles guardam o texto da comodidade.
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAuthenticated();
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    const parsed = parseComodidade(await req.json().catch(() => ({})));
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("tipos_comodidade")
      .update({ ...parsed.value, updatedat: new Date().toISOString() })
      .eq("id", id)
      .select("id, nome, descricao, ativo")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Tipo de comodidade não encontrado." }, { status: 404 });
    return NextResponse.json({ item: mapComodidade(data) });
  } catch (error) {
    return comodidadeFailure(error, "PUT", "Erro ao atualizar tipo de comodidade");
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAuthenticated();
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    const { data, error } = await supabaseAdmin.from("tipos_comodidade").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Tipo de comodidade não encontrado." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return comodidadeFailure(error, "DELETE", "Erro ao excluir tipo de comodidade");
  }
}
