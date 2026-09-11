// src/app/api/tipos/grupos-produto/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";


async function ensureAuth() {
  await requireAuthenticated();
}

function parseId(paramId: string): number | null {
  const n = Number(paramId);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// PUT -> atualizar nome/descricao/ativo/exibirPdv
export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureAuth();

    const { id } = await context.params;
    const grupoId = parseId(id);
    if (!grupoId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { nome, descricao, ativo, exibirPdv } = body ?? {};

    if (exibirPdv !== undefined && typeof exibirPdv !== "boolean") {
      return NextResponse.json(
        { error: "Campo 'exibirPdv' deve ser booleano." },
        { status: 400 }
      );
    }

    if (!nome?.trim()) {
      return NextResponse.json(
        { error: "Nome do grupo é obrigatório." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const payload: Record<string, any> = {
      nome: nome.trim(),
      descricao: descricao?.trim() || null,
      updatedat: now,
    };

    if (typeof ativo === "boolean") {
      payload.ativo = ativo;
    }
    if (typeof exibirPdv === "boolean") {
      payload.exibirPdv = exibirPdv;
    }

    const { data, error } = await supabaseAdmin
      .from("produtogrupo")
      .update(payload)
      .eq("id", grupoId)
      .select(`
        id,
        nome,
        descricao,
        ativo,
        exibirPdv
      `)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Grupo de produto não encontrado." },
        { status: 404 }
      );
    }

    const item = {
      id: data.id as number,
      nome: data.nome as string,
      descricao: (data.descricao as string | null) ?? null,
      ativo: typeof data.ativo === "boolean" ? data.ativo : true,
      exibirPdv: data.exibirPdv,
    };

    return NextResponse.json({ item });
  } catch (e: any) {
    console.error("[/api/tipos/grupos-produto/:id PUT] error:", e);
    const status = /auth|unauth|não autenticado/i.test(String(e?.message))
      ? 401
      : 500;

    return NextResponse.json(
      { error: e?.message ?? "Erro ao atualizar grupo de produto" },
      { status }
    );
  }
}

// PATCH -> alterar somente 'ativo'
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureAuth();

    const { id } = await context.params;
    const grupoId = parseId(id);
    if (!grupoId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { ativo } = body as { ativo?: boolean };

    if (typeof ativo !== "boolean") {
      return NextResponse.json(
        { error: "Campo 'ativo' deve ser booleano." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("produtogrupo")
      .update({ ativo, updatedat: now })
      .eq("id", grupoId)
      .select(`
        id,
        nome,
        descricao,
        ativo,
        exibirPdv
      `)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Grupo de produto não encontrado." },
        { status: 404 }
      );
    }

    const item = {
      id: data.id as number,
      nome: data.nome as string,
      descricao: (data.descricao as string | null) ?? null,
      ativo: typeof data.ativo === "boolean" ? data.ativo : ativo,
      exibirPdv: data.exibirPdv,
    };

    return NextResponse.json({ item });
  } catch (e: any) {
    console.error("[/api/tipos/grupos-produto/:id PATCH] error:", e);
    const status = /auth|unauth|não autenticado/i.test(String(e?.message))
      ? 401
      : 500;

    return NextResponse.json(
      { error: e?.message ?? "Erro ao atualizar status do grupo" },
      { status }
    );
  }
}
