export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isOpen() {
  const value = String(process.env.OPEN_PERMISSIONS ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "sim"].includes(value);
}

async function ensureAuth() {
  if (!isOpen()) await auth();
}

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureAuth();
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const nome = String(body.nome ?? "").trim();
    if (!nome) return NextResponse.json({ error: "Nome do centro de custo é obrigatório." }, { status: 400 });

    const payload: Record<string, unknown> = {
      nome,
      descricao: String(body.descricao ?? "").trim() || null,
      updatedat: new Date().toISOString(),
    };
    if (typeof body.ativo === "boolean") payload.ativo = body.ativo;

    const { data, error } = await supabaseAdmin
      .from("centrosdecusto")
      .update(payload)
      .eq("id", id)
      .select("id, nome, descricao, ativo")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Centro de custo não encontrado." }, { status: 404 });
    return NextResponse.json({ item: { ...data, icone: "other", codigo_sistema: null } });
  } catch (error: any) {
    console.error("[/api/tipos/centros-de-custo/:id PUT] error:", error);
    const message = String(error?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(message)
      ? 401
      : /duplicate|unique|centrosdecusto_nome_unique/i.test(message)
        ? 409
        : 500;
    return NextResponse.json(
      { error: status === 409 ? "Já existe um centro de custo com este nome." : error?.message ?? "Erro ao atualizar centro de custo" },
      { status },
    );
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureAuth();
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    if (typeof body.ativo !== "boolean") {
      return NextResponse.json({ error: "Campo ativo deve ser booleano." }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin
      .from("centrosdecusto")
      .update({ ativo: body.ativo, updatedat: new Date().toISOString() })
      .eq("id", id)
      .select("id, nome, descricao, ativo")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Centro de custo não encontrado." }, { status: 404 });
    return NextResponse.json({ item: { ...data, icone: "other", codigo_sistema: null } });
  } catch (error: any) {
    console.error("[/api/tipos/centros-de-custo/:id PATCH] error:", error);
    return NextResponse.json({ error: error?.message ?? "Erro ao atualizar centro de custo" }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureAuth();
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    const { error } = await supabaseAdmin.from("centrosdecusto").delete().eq("id", id);
    if (error) throw error;
    return new NextResponse(null, { status: 204 });
  } catch (error: any) {
    console.error("[/api/tipos/centros-de-custo/:id DELETE] error:", error);
    return NextResponse.json({ error: error?.message ?? "Erro ao excluir centro de custo" }, { status: 500 });
  }
}
