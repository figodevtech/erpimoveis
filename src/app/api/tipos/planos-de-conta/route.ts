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

// GET /api/tipos/planos-de-conta
export async function GET(req: NextRequest) {
  try {
    await ensureAuth();
    const url = new URL(req.url);
    const ativo = url.searchParams.get("ativo");
    let q = supabaseAdmin
      .from("planosdeconta")
      .select(`id, codigo, nome, descricao, ativo`)
      .order("codigo", { ascending: true, nullsFirst: false })
      .order("nome", { ascending: true });
    if (ativo === "true") q = q.eq("ativo", true);
    if (ativo === "false") q = q.eq("ativo", false);

    const { data, error } = await q;

    if (error) throw error;

    const items =
      (data ?? []).map((c) => ({
        id: c.id as number,
        codigo: (c.codigo as string | null) ?? null,
        nome: c.nome as string,
        descricao: (c.descricao as string | null) ?? null,
        ativo: typeof c.ativo === "boolean" ? (c.ativo as boolean) : true,
      })) ?? [];

    return NextResponse.json({ items });
  } catch (e: any) {
    console.error("[/api/tipos/planos-de-conta GET] error:", e);
    const msg = String(e?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(msg) ? 401 : 500;

    return NextResponse.json(
      {
        error: e?.message ?? "Erro ao carregar planos de conta",
      },
      { status },
    );
  }
}

// POST /api/tipos/planos-de-conta
export async function POST(req: NextRequest) {
  try {
    await ensureAuth();

    const body = await req.json().catch(() => ({}));
    const { codigo, nome, descricao, ativo } = body as {
      codigo?: string | null;
      nome?: string;
      descricao?: string | null;
      ativo?: boolean;
    };

    if (!nome?.trim()) {
      return NextResponse.json(
        { error: "Nome do plano de conta é obrigatório." },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const payload = {
      codigo: codigo?.trim() || null,
      nome: nome.trim().toUpperCase(),
      descricao: descricao?.trim() || null,
      ativo: typeof ativo === "boolean" ? ativo : true,
      createdat: now,
      updatedat: now,
    };

    const { data, error } = await supabaseAdmin
      .from("planosdeconta")
      .insert(payload)
      .select(
        `
        id,
        codigo,
        nome,
        descricao,
        ativo
      `,
      )
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Falha ao criar plano de conta." },
        { status: 500 },
      );
    }

    const item = {
      id: data.id as number,
      codigo: (data.codigo as string | null) ?? null,
      nome: data.nome as string,
      descricao: (data.descricao as string | null) ?? null,
      ativo: typeof data.ativo === "boolean" ? (data.ativo as boolean) : true,
    };

    return NextResponse.json({ item }, { status: 201 });
  } catch (e: any) {
    console.error("[/api/tipos/planos-de-conta POST] error:", e);
    const msg = String(e?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(msg)
      ? 401
      : /duplicate|unique|planosdeconta_nome_key/i.test(msg)
        ? 409
        : 500;

    return NextResponse.json(
      {
        error: e?.message ?? "Erro ao cadastrar plano de conta",
      },
      { status },
    );
  }
}
