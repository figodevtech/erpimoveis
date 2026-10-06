// src/app/api/tipos/grupos-produto/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";


async function ensureAuth() {
  await requireAuthenticated();
}

// GET /api/tipos/grupos-produto -> listar
export async function GET() {
  try {
    await ensureAuth();

    const { data, error } = await supabaseAdmin
      .from("produtogrupo")
      .select(`
        id,
        nome,
        descricao,
        ativo,
        exibirPdv,
        exibirSite
      `)
      .order("nome", { ascending: true });

    if (error) throw error;

    const items = (data ?? []).map((g: any) => ({
      id: g.id as number,
      nome: g.nome as string,
      descricao: (g.descricao as string | null) ?? null,
      ativo: typeof g.ativo === "boolean" ? g.ativo : true,
      exibirPdv: g.exibirPdv,
      exibirSite: g.exibirSite,
    }));

    return NextResponse.json({ items });
  } catch (e: any) {
    console.error("[/api/tipos/grupos-produto GET] error:", e);
    const status = /auth|unauth|não autenticado/i.test(String(e?.message))
      ? 401
      : 500;
    return NextResponse.json(
      { error: e?.message ?? "Erro ao carregar grupos de produto" },
      { status }
    );
  }
}

// POST /api/tipos/grupos-produto -> criar
export async function POST(req: Request) {
  try {
    await ensureAuth();

    const body = await req.json().catch(() => ({}));
    const { nome, descricao, ativo, exibirPdv, exibirSite } = body ?? {};

    if (exibirPdv !== undefined && typeof exibirPdv !== "boolean") {
      return NextResponse.json(
        { error: "Campo 'exibirPdv' deve ser booleano." },
        { status: 400 }
      );
    }
    if (exibirSite !== undefined && typeof exibirSite !== "boolean") {
      return NextResponse.json(
        { error: "Campo 'exibirSite' deve ser booleano." },
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
      ativo: typeof ativo === "boolean" ? ativo : true,
      exibirPdv: exibirPdv ?? true,
      exibirSite: exibirSite ?? true,
      createdat: now,
      updatedat: now,
    };

    const { data, error } = await supabaseAdmin
      .from("produtogrupo")
      .insert(payload)
      .select(`
        id,
        nome,
        descricao,
        ativo,
        exibirPdv,
        exibirSite
      `)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Erro ao criar grupo de produto." },
        { status: 500 }
      );
    }

    const item = {
      id: data.id as number,
      nome: data.nome as string,
      descricao: (data.descricao as string | null) ?? null,
      ativo: typeof data.ativo === "boolean" ? data.ativo : true,
      exibirPdv: data.exibirPdv,
      exibirSite: data.exibirSite,
    };

    return NextResponse.json({ item }, { status: 201 });
  } catch (e: any) {
    console.error("[/api/tipos/grupos-produto POST] error:", e);
    const msg = String(e?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(msg) ? 401 : 500;

    return NextResponse.json(
      { error: e?.message ?? "Erro ao criar grupo de produto" },
      { status }
    );
  }
}
