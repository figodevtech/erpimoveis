// src/app/api/tipos/unidades-medida/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";


async function ensureAuth() {
  await requireAuthenticated();
}

// GET /api/tipos/unidades-medida
export async function GET() {
  try {
    await ensureAuth();

    const { data, error } = await supabaseAdmin
      .from("unidademedida")
      .select(
        `
        id,
        sigla,
        descricao,
        ativo
      `
      )
      .order("sigla", { ascending: true });

    if (error) throw error;

    const items =
      (data ?? []).map((u) => ({
        id: u.id as number,
        sigla: String(u.sigla ?? ""),
        descricao: (u.descricao as string | null) ?? null,
        ativo:
          typeof u.ativo === "boolean"
            ? (u.ativo as boolean)
            : true,
      })) ?? [];

    return NextResponse.json({ items });
  } catch (e: any) {
    console.error("[/api/tipos/unidades-medida GET] error:", e);
    const status = /auth|unauth|não autenticado/i.test(String(e?.message ?? ""))
      ? 401
      : 500;

    return NextResponse.json(
      { error: e?.message ?? "Erro ao buscar unidades de medida" },
      { status }
    );
  }
}

// POST /api/tipos/unidades-medida
export async function POST(req: NextRequest) {
  try {
    await ensureAuth();

    const body = await req.json().catch(() => ({}));
    const {
      sigla,
      descricao,
    }: { sigla?: string; descricao?: string | null } = body ?? {};

    if (!sigla?.trim()) {
      return NextResponse.json(
        { error: "Sigla é obrigatória." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const payload = {
      sigla: sigla.trim().toUpperCase(),
      descricao: descricao?.trim() || null,
      ativo: true,
      createdat: now,
      updatedat: now,
    };

    const { data, error } = await supabaseAdmin
      .from("unidademedida")
      .insert(payload)
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
        { error: "Falha ao criar unidade de medida." },
        { status: 500 }
      );
    }

    const item = {
      id: data.id as number,
      sigla: String(data.sigla ?? ""),
      descricao: (data.descricao as string | null) ?? null,
      ativo:
        typeof data.ativo === "boolean"
          ? (data.ativo as boolean)
          : true,
    };

    return NextResponse.json({ item }, { status: 201 });
  } catch (e: any) {
    console.error("[/api/tipos/unidades-medida POST] error:", e);
    const msg = String(e?.message ?? "");
    const status = /unique|duplicate|unidademedida_sigla_key/i.test(msg)
      ? 409
      : /auth|unauth|não autenticado/i.test(msg)
      ? 401
      : 500;

    return NextResponse.json(
      { error: e?.message ?? "Erro ao criar unidade de medida" },
      { status }
    );
  }
}
