// src/app/api/tipos/bancos/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";


async function ensureAuth() {
  await requireAuthenticated();
}

// GET /api/tipos/bancos -> listar contas bancárias
export async function GET() {
  try {
    await ensureAuth();

    const { data, error } = await supabaseAdmin
      .from("bancoconta")
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
      .order("titulo", { ascending: true });

    if (error) throw error;

    const items = (data ?? []).map((c: any) => ({
      id: c.id as number,
      titulo: c.titulo as string,
      valorinicial: Number(c.valorinicial ?? 0),
      agencia: (c.agencia as string | null) ?? null,
      contanumero: (c.contanumero as string | null) ?? null,
      tipo: c.tipo as string,
      proprietario: (c.proprietario as string | null) ?? null,
      ativo: typeof c.ativo === "boolean" ? c.ativo : true,
    }));

    return NextResponse.json({ items });
  } catch (e: any) {
    console.error("[/api/tipos/bancos GET] error:", e);
    const status = /auth|unauth|não autenticado/i.test(String(e?.message))
      ? 401
      : 500;
    return NextResponse.json(
      { error: e?.message ?? "Erro ao carregar contas bancárias" },
      { status }
    );
  }
}

// POST /api/tipos/bancos -> criar conta bancária
export async function POST(req: Request) {
  try {
    await ensureAuth();

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
      ativo: typeof ativo === "boolean" ? ativo : true,
      created_at: now,
      updated_at: now,
    };

    const { data, error } = await supabaseAdmin
      .from("bancoconta")
      .insert(payload)
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
        { error: "Erro ao criar conta bancária." },
        { status: 500 }
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

    return NextResponse.json({ item }, { status: 201 });
  } catch (e: any) {
    console.error("[/api/tipos/bancos POST] error:", e);
    const msg = String(e?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(msg) ? 401 : 500;

    return NextResponse.json(
      { error: e?.message ?? "Erro ao criar conta bancária" },
      { status }
    );
  }
}
