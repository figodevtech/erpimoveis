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

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureAuth();

    const { id } = await context.params;
    const categoriaId = parseId(id);
    if (!categoriaId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { nome, descricao, ativo } = body as {
      nome?: string;
      descricao?: string | null;
      ativo?: boolean;
    };

    if (!nome?.trim()) {
      return NextResponse.json({ error: "Nome da categoria é obrigatório." }, { status: 400 });
    }

    const payload: Record<string, any> = {
      nome: nome.trim().toUpperCase(),
      descricao: descricao?.trim() || null,
      updatedat: new Date().toISOString(),
    };

    if (typeof ativo === "boolean") payload.ativo = ativo;

    const { data, error } = await supabaseAdmin
      .from("categoriavenda")
      .update(payload)
      .eq("id", categoriaId)
      .select("id, nome, descricao, ativo")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Categoria de venda não encontrada." }, { status: 404 });
    }

    const item = {
      id: Number(data.id),
      nome: String(data.nome ?? ""),
      descricao: (data.descricao as string | null) ?? null,
      ativo: typeof data.ativo === "boolean" ? data.ativo : typeof ativo === "boolean" ? ativo : true,
    };

    return NextResponse.json({ item });
  } catch (e: any) {
    console.error("[/api/tipos/categorias-venda/:id PUT] error:", e);
    const msg = String(e?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(msg)
      ? 401
      : /duplicate|unique|categoriavenda_nome_key/i.test(msg)
      ? 409
      : 500;
    return NextResponse.json({ error: e?.message ?? "Erro ao atualizar categoria de venda" }, { status });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureAuth();

    const { id } = await context.params;
    const categoriaId = parseId(id);
    if (!categoriaId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { ativo } = body as { ativo?: boolean };
    if (typeof ativo !== "boolean") {
      return NextResponse.json({ error: "Campo 'ativo' deve ser booleano." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("categoriavenda")
      .update({ ativo, updatedat: new Date().toISOString() })
      .eq("id", categoriaId)
      .select("id, nome, descricao, ativo")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Categoria de venda não encontrada." }, { status: 404 });
    }

    const item = {
      id: Number(data.id),
      nome: String(data.nome ?? ""),
      descricao: (data.descricao as string | null) ?? null,
      ativo: typeof data.ativo === "boolean" ? data.ativo : ativo,
    };

    return NextResponse.json({ item });
  } catch (e: any) {
    console.error("[/api/tipos/categorias-venda/:id PATCH] error:", e);
    const status = /auth|unauth|não autenticado/i.test(String(e?.message)) ? 401 : 500;
    return NextResponse.json({ error: e?.message ?? "Erro ao atualizar status da categoria de venda" }, { status });
  }
}
