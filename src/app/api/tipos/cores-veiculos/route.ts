// src/app/api/tipos/cores-veiculos/route.ts
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

// GET /api/tipos/cores-veiculos?somenteAtivas=1
export async function GET(req: NextRequest) {
  try {
    await ensureAuth();

    const url = new URL(req.url);
    const somenteAtivas = url.searchParams.get("somenteAtivas") === "1";

    let q = supabaseAdmin
      .from("cores_veiculos")
      .select(`id, nome, ativo`)
      .order("nome", { ascending: true });

    if (somenteAtivas) q = q.eq("ativo", true);

    const { data, error } = await q;
    if (error) throw error;

    const items =
      (data ?? []).map((c) => ({
        id: c.id as string,
        nome: c.nome as string,
        ativo: typeof c.ativo === "boolean" ? (c.ativo as boolean) : true,
      })) ?? [];

    return NextResponse.json({ items });
  } catch (e: any) {
    console.error("[/api/tipos/cores-veiculos GET] error:", e);
    const msg = String(e?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(msg) ? 401 : 500;

    return NextResponse.json(
      { error: e?.message ?? "Erro ao carregar cores de veículo" },
      { status }
    );
  }
}

// POST /api/tipos/cores-veiculos
export async function POST(req: NextRequest) {
  try {
    const session = await ensureAuth();
    const userId = extractUserId(session);

    const body = await req.json().catch(() => ({}));
    const { nome, ativo } = body as { nome?: string; ativo?: boolean };

    if (!nome?.trim()) {
      return NextResponse.json(
        { error: "Nome da cor é obrigatório." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const payload = {
      nome: nome.trim().toUpperCase(),
      ativo: typeof ativo === "boolean" ? ativo : true,
      created_at: now,
      updated_at: now,
      created_by: userId,
      updated_by: userId,
    };

    const { data, error } = await supabaseAdmin
      .from("cores_veiculos")
      .insert(payload)
      .select(`id, nome, ativo`)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Falha ao criar cor." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        item: {
          id: data.id as string,
          nome: data.nome as string,
          ativo:
            typeof data.ativo === "boolean" ? (data.ativo as boolean) : true,
        },
      },
      { status: 201 }
    );
  } catch (e: any) {
    console.error("[/api/tipos/cores-veiculos POST] error:", e);
    const msg = String(e?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(msg)
      ? 401
      : /duplicate|unique|cores_veiculos_nome_key/i.test(msg)
      ? 409
      : 500;

    return NextResponse.json(
      { error: e?.message ?? "Erro ao cadastrar cor de veículo" },
      { status }
    );
  }
}
