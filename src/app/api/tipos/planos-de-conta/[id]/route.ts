export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isOpen() {
  const v = (process.env.OPEN_PERMISSIONS ?? "")
    .toString()
    .trim()
    .toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "sim";
}

async function ensureAuth() {
  if (isOpen()) return;
  await auth();
}

function parseId(paramId: string): number | null {
  const n = Number(paramId);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// PUT /api/tipos/planos-de-conta/[id]
export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureAuth();

    const { id } = await context.params;
    const planoId = parseId(id);
    if (!planoId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { codigo, nome, descricao, ativo, grupo_id } = body as {
      codigo?: string | null;
      nome?: string;
      descricao?: string | null;
      ativo?: boolean;
      grupo_id?: number | string | null;
    };

    if (!nome?.trim()) {
      return NextResponse.json(
        { error: "Nome do plano de conta é obrigatório." },
        { status: 400 },
      );
    }

    const grupoId = Number(grupo_id);
    if (!Number.isInteger(grupoId) || grupoId <= 0) {
      return NextResponse.json(
        { error: "Grupo do plano de conta é obrigatório." },
        { status: 400 },
      );
    }

    const { data: grupo, error: grupoError } = await supabaseAdmin
      .from("planosdecontagrupos")
      .select("id")
      .eq("id", grupoId)
      .maybeSingle();
    if (grupoError) throw grupoError;
    if (!grupo) {
      return NextResponse.json({ error: "Grupo de plano de conta não encontrado." }, { status: 404 });
    }

    const now = new Date().toISOString();

    const payload: Record<string, any> = {
      codigo: codigo?.trim() || null,
      nome: nome.trim(),
      descricao: descricao?.trim() || null,
      grupo_id: grupoId,
      updatedat: now,
    };

    if (typeof ativo === "boolean") {
      payload.ativo = ativo;
    }

    const { data, error } = await supabaseAdmin
      .from("planosdeconta")
      .update(payload)
      .eq("id", planoId)
      .select(`
        id,
        codigo,
        nome,
        descricao,
        ativo,
        grupo_id,
        grupo:planosdecontagrupos!planosdeconta_grupo_id_fkey!inner (
          id,
          codigo,
          nome,
          descricao,
          ativo
        )
      `)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Plano de conta não encontrado." },
        { status: 404 },
      );
    }

    const item = {
      id: data.id as number,
      codigo: (data.codigo as string | null) ?? null,
      nome: data.nome as string,
      descricao: (data.descricao as string | null) ?? null,
      grupo_id: data.grupo_id as number,
      grupo: Array.isArray(data.grupo) ? data.grupo[0] ?? null : data.grupo,
      icone: "other",
      codigo_sistema: null,
      ativo: typeof data.ativo === "boolean" ? (data.ativo as boolean) : true,
    };

    return NextResponse.json({ item });
  } catch (e: any) {
    console.error("[/api/tipos/planos-de-conta/:id PUT] error:", e);
    const msg = String(e?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(msg)
      ? 401
      : /duplicate|unique|planosdeconta_(grupo_nome|codigo)_unique/i.test(msg)
        ? 409
        : 500;

    return NextResponse.json(
      {
        error: e?.message ?? "Erro ao atualizar plano de conta",
      },
      { status },
    );
  }
}

// PATCH /api/tipos/planos-de-conta/[id] -> altera apenas 'ativo'
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureAuth();

    const { id } = await context.params;
    const planoId = parseId(id);
    if (!planoId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { ativo } = body as { ativo?: boolean };

    if (typeof ativo !== "boolean") {
      return NextResponse.json(
        { error: "Campo 'ativo' deve ser boolean." },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("planosdeconta")
      .update({ ativo, updatedat: now })
      .eq("id", planoId)
      .select(`id, nome, descricao, ativo`)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Plano de conta não encontrado." },
        { status: 404 },
      );
    }

    const item = {
      id: data.id as number,
      nome: data.nome as string,
      descricao: (data.descricao as string | null) ?? null,
      icone: "other",
      codigo_sistema: null,
      ativo: typeof data.ativo === "boolean" ? (data.ativo as boolean) : true,
    };

    return NextResponse.json({ item });
  } catch (e: any) {
    console.error("[/api/tipos/planos-de-conta/:id PATCH] error:", e);
    const msg = String(e?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(msg) ? 401 : 500;

    return NextResponse.json(
      {
        error: e?.message ?? "Erro ao atualizar status do plano de conta",
      },
      { status },
    );
  }
}

// DELETE /api/tipos/planos-de-conta/[id]
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureAuth();

    const { id } = await context.params;
    const planoId = parseId(id);
    if (!planoId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("planosdeconta")
      .delete()
      .eq("id", planoId);

    if (error) throw error;

    return new NextResponse(null, { status: 204 });
  } catch (e: any) {
    console.error("[/api/tipos/planos-de-conta/:id DELETE] error:", e);
    const msg = String(e?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(msg) ? 401 : 500;

    return NextResponse.json(
      {
        error: e?.message ?? "Erro ao deletar plano de conta",
      },
      { status },
    );
  }
}
