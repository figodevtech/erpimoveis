// src/app/api/tipos/unidades-medida/[id]/route.ts
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

// PUT /api/tipos/unidades-medida/[id]
// Atualiza sigla, descrição e (opcionalmente) ativo
export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureAuth();

    const { id } = await context.params;
    const unidadeId = parseId(id);
    if (!unidadeId) {
      return NextResponse.json(
        { error: "ID inválido." },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const {
      sigla,
      descricao,
      ativo,
    } = body as {
      sigla?: string;
      descricao?: string | null;
      ativo?: boolean;
    };

    if (!sigla?.trim()) {
      return NextResponse.json(
        { error: "Sigla é obrigatória." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const payload: Record<string, any> = {
      sigla: sigla.trim().toUpperCase(),
      descricao: descricao?.trim() || null,
      updatedat: now,
    };

    // Se o front estiver enviando ativo, atualiza também
    if (typeof ativo === "boolean") {
      payload.ativo = ativo;
    }

    const { data, error } = await supabaseAdmin
      .from("unidademedida")
      .update(payload)
      .eq("id", unidadeId)
      .select(
        `
        id,
        sigla,
        descricao,
        ativo
      `
      )
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Unidade de medida não encontrada." },
        { status: 404 }
      );
    }

    const item = {
      id: data.id as number,
      sigla: data.sigla as string,
      descricao: (data.descricao as string | null) ?? null,
      ativo:
        typeof data.ativo === "boolean"
          ? (data.ativo as boolean)
          : typeof ativo === "boolean"
          ? ativo
          : true,
    };

    return NextResponse.json({ item });
  } catch (e: any) {
    console.error("[/api/tipos/unidades-medida/:id PUT] error:", e);
    const msg = String(e?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(msg)
      ? 401
      : /duplicate|unique|unidademedida_sigla_key/i.test(msg)
      ? 409
      : 500;

    return NextResponse.json(
      { error: e?.message ?? "Erro ao atualizar unidade de medida" },
      { status }
    );
  }
}

// PATCH /api/tipos/unidades-medida/[id]
// Opcional: alterar somente 'ativo' (caso queira usar em outro lugar)
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureAuth();

    const { id } = await context.params;
    const unidadeId = parseId(id);
    if (!unidadeId) {
      return NextResponse.json(
        { error: "ID inválido." },
        { status: 400 }
      );
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
      .from("unidademedida")
      .update({ ativo, updatedat: now })
      .eq("id", unidadeId)
      .select(
        `
        id,
        sigla,
        descricao,
        ativo
      `
      )
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Unidade de medida não encontrada." },
        { status: 404 }
      );
    }

    const item = {
      id: data.id as number,
      sigla: data.sigla as string,
      descricao: (data.descricao as string | null) ?? null,
      ativo:
        typeof data.ativo === "boolean"
          ? (data.ativo as boolean)
          : ativo,
    };

    return NextResponse.json({ item });
  } catch (e: any) {
    console.error("[/api/tipos/unidades-medida/:id PATCH] error:", e);
    const status = /auth|unauth|não autenticado/i.test(
      String(e?.message)
    )
      ? 401
      : 500;

    return NextResponse.json(
      {
        error:
          e?.message ??
          "Erro ao atualizar status da unidade de medida",
      },
      { status }
    );
  }
}
