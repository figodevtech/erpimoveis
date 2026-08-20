export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";


async function ensureAuth() {
  await requireAuthenticated();
}

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureAuth();
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const codigo = String(body.codigo ?? "").trim();
    const nome = String(body.nome ?? "").trim();
    const descricao = String(body.descricao ?? "").trim();
    if (!codigo) return NextResponse.json({ error: "Código do grupo é obrigatório." }, { status: 400 });
    if (!nome) return NextResponse.json({ error: "Nome do grupo é obrigatório." }, { status: 400 });

    const payload: Record<string, unknown> = {
      codigo,
      nome,
      descricao: descricao || null,
      updatedat: new Date().toISOString(),
    };
    if (typeof body.ativo === "boolean") payload.ativo = body.ativo;

    const { data, error } = await supabaseAdmin
      .from("planosdecontagrupos")
      .update(payload)
      .eq("id", id)
      .select("id, codigo, nome, descricao, ativo")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Grupo não encontrado." }, { status: 404 });

    return NextResponse.json({ item: data });
  } catch (error: any) {
    console.error("[/api/tipos/grupos-planos-de-conta/:id PUT] error:", error);
    const message = String(error?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(message)
      ? 401
      : /duplicate|unique|planosdecontagrupos_(codigo|nome)_unique/i.test(message)
        ? 409
        : 500;
    return NextResponse.json(
      { error: status === 409 ? "Já existe um grupo com este código ou nome." : error?.message ?? "Erro ao atualizar grupo" },
      { status },
    );
  }
}
