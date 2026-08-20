// src/app/api/tipos/cores-veiculos/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";


async function ensureAuth() {
  return requireAuthenticated();
}

function extractUserId(session: any): string | null {
  const id =
    session?.user?.id ??
    session?.user?.sub ??
    session?.session?.user?.id ??
    session?.session?.user?.sub ??
    null;

  return typeof id === "string" && id.trim() ? id : null;
}

function parseUuid(paramId: string): string | null {
  const v = String(paramId ?? "").trim();
  if (!v) return null;
  return v;
}

// PUT /api/tipos/cores-veiculos/[id]
export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await ensureAuth();
    const userId = extractUserId(session);

    const { id } = await context.params;
    const corId = parseUuid(id);
    if (!corId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { nome, ativo } = body as { nome?: string; ativo?: boolean };

    if (!nome?.trim()) {
      return NextResponse.json(
        { error: "Nome da cor é obrigatório." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const payload: Record<string, any> = {
      nome: nome.trim().toUpperCase(),
      updated_at: now,
      updated_by: userId,
    };

    if (typeof ativo === "boolean") payload.ativo = ativo;

    const { data, error } = await supabaseAdmin
      .from("cores_veiculos")
      .update(payload)
      .eq("id", corId)
      .select(`id, nome, ativo`)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Cor de veículo não encontrada." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      item: {
        id: data.id as string,
        nome: data.nome as string,
        ativo: typeof data.ativo === "boolean" ? (data.ativo as boolean) : true,
      },
    });
  } catch (e: any) {
    console.error("[/api/tipos/cores-veiculos/:id PUT] error:", e);
    const msg = String(e?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(msg)
      ? 401
      : /duplicate|unique|cores_veiculos_nome_key/i.test(msg)
      ? 409
      : 500;

    return NextResponse.json(
      { error: e?.message ?? "Erro ao atualizar cor de veículo" },
      { status }
    );
  }
}

// PATCH /api/tipos/cores-veiculos/[id]
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await ensureAuth();
    const userId = extractUserId(session);

    const { id } = await context.params;
    const corId = parseUuid(id);
    if (!corId) {
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
      .from("cores_veiculos")
      .update({ ativo, updated_at: now, updated_by: userId })
      .eq("id", corId)
      .select(`id, nome, ativo`)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Cor de veículo não encontrada." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      item: {
        id: data.id as string,
        nome: data.nome as string,
        ativo:
          typeof data.ativo === "boolean" ? (data.ativo as boolean) : ativo,
      },
    });
  } catch (e: any) {
    console.error("[/api/tipos/cores-veiculos/:id PATCH] error:", e);
    const status = /auth|unauth|não autenticado/i.test(String(e?.message ?? ""))
      ? 401
      : 500;

    return NextResponse.json(
      { error: e?.message ?? "Erro ao atualizar status da cor de veículo" },
      { status }
    );
  }
}
