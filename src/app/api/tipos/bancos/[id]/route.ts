// src/app/api/tipos/bancos/[id]/route.ts
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

// PUT /api/tipos/bancos/[id] -> atualizar conta completa (inclui 'ativo')
export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureAuth();

    const { id } = await context.params;
    const contaId = parseId(id);
    if (!contaId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      titulo,
      valorinicial,
      agencia,
      contanumero,
      tipo,
      proprietario,
      ativo,
    } = body ?? {};

    if (!titulo?.trim()) {
      return NextResponse.json(
        { error: "Título da conta é obrigatório." },
        { status: 400 }
      );
    }

    const valor = Number(valorinicial);
    if (!Number.isFinite(valor)) {
      return NextResponse.json(
        { error: "Valor inicial inválido." },
        { status: 400 }
      );
    }

    if (!tipo?.trim()) {
      return NextResponse.json(
        { error: "Tipo da conta é obrigatório." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const payload: Record<string, any> = {
      titulo: titulo.trim(),
      valorinicial: valor,
      agencia: agencia?.trim() || null,
      contanumero: contanumero?.trim() || null,
      tipo: tipo.trim(),
      proprietario: proprietario?.trim() || null,
      updated_at: now,
    };

    if (typeof ativo === "boolean") {
      payload.ativo = ativo;
    }

    const { data, error } = await supabaseAdmin
      .from("bancoconta")
      .update(payload)
      .eq("id", contaId)
      .select(`
        id,
        titulo,
        valorinicial,
        agencia,
        contanumero,
        tipo,
        proprietario,
        ativo
      `)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Conta bancária não encontrada." },
        { status: 404 }
      );
    }

    const item = {
      id: data.id as number,
      titulo: data.titulo as string,
      valorinicial: Number(data.valorinicial ?? 0),
      agencia: (data.agencia as string | null) ?? null,
      contanumero: (data.contanumero as string | null) ?? null,
      tipo: data.tipo as string,
      proprietario: (data.proprietario as string | null) ?? null,
      ativo: typeof data.ativo === "boolean" ? data.ativo : true,
    };

    return NextResponse.json({ item });
  } catch (e: any) {
    console.error("[/api/tipos/bancos/:id PUT] error:", e);
    const msg = String(e?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(msg) ? 401 : 500;

    return NextResponse.json(
      { error: e?.message ?? "Erro ao atualizar conta bancária" },
      { status }
    );
  }
}

// PATCH /api/tipos/bancos/[id] -> alterar somente 'ativo' (se quiser usar no futuro)
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureAuth();

    const { id } = await context.params;
    const contaId = parseId(id);
    if (!contaId) {
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
      .from("bancoconta")
      .update({ ativo, updated_at: now })
      .eq("id", contaId)
      .select(`
        id,
        titulo,
        valorinicial,
        agencia,
        contanumero,
        tipo,
        proprietario,
        ativo
      `)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Conta bancária não encontrada." },
        { status: 404 }
      );
    }

    const item = {
      id: data.id as number,
      titulo: data.titulo as string,
      valorinicial: Number(data.valorinicial ?? 0),
      agencia: (data.agencia as string | null) ?? null,
      contanumero: (data.contanumero as string | null) ?? null,
      tipo: data.tipo as string,
      proprietario: (data.proprietario as string | null) ?? null,
      ativo: typeof data.ativo === "boolean" ? data.ativo : ativo,
    };

    return NextResponse.json({ item });
  } catch (e: any) {
    console.error("[/api/tipos/bancos/:id PATCH] error:", e);
    const status = /auth|unauth|não autenticado/i.test(String(e?.message))
      ? 401
      : 500;
    return NextResponse.json(
      { error: e?.message ?? "Erro ao atualizar status da conta" },
      { status }
    );
  }
}
