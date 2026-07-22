export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isOpen() {
  const value = String(process.env.OPEN_PERMISSIONS ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "sim"].includes(value);
}

async function ensureAuth() {
  if (!isOpen()) await auth();
}

function mapGroup(row: any) {
  return {
    id: Number(row.id),
    codigo: String(row.codigo ?? ""),
    nome: String(row.nome ?? ""),
    descricao: (row.descricao as string | null) ?? null,
    ativo: typeof row.ativo === "boolean" ? row.ativo : true,
  };
}

export async function GET(req: NextRequest) {
  try {
    await ensureAuth();
    const ativo = new URL(req.url).searchParams.get("ativo");
    let query = supabaseAdmin
      .from("planosdecontagrupos")
      .select("id, codigo, nome, descricao, ativo")
      .order("codigo", { ascending: true })
      .order("nome", { ascending: true });
    if (ativo === "true") query = query.eq("ativo", true);
    if (ativo === "false") query = query.eq("ativo", false);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ items: (data ?? []).map(mapGroup) });
  } catch (error: any) {
    console.error("[/api/tipos/grupos-planos-de-conta GET] error:", error);
    const message = String(error?.message ?? "");
    return NextResponse.json(
      { error: error?.message ?? "Erro ao carregar grupos de planos de conta" },
      { status: /auth|unauth|não autenticado/i.test(message) ? 401 : 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureAuth();
    const body = await req.json().catch(() => ({}));
    const codigo = String(body.codigo ?? "").trim();
    const nome = String(body.nome ?? "").trim();
    const descricao = String(body.descricao ?? "").trim();

    if (!codigo) return NextResponse.json({ error: "Código do grupo é obrigatório." }, { status: 400 });
    if (!nome) return NextResponse.json({ error: "Nome do grupo é obrigatório." }, { status: 400 });

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("planosdecontagrupos")
      .insert({
        codigo,
        nome,
        descricao: descricao || null,
        ativo: typeof body.ativo === "boolean" ? body.ativo : true,
        createdat: now,
        updatedat: now,
      })
      .select("id, codigo, nome, descricao, ativo")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Falha ao criar grupo." }, { status: 500 });

    return NextResponse.json({ item: mapGroup(data) }, { status: 201 });
  } catch (error: any) {
    console.error("[/api/tipos/grupos-planos-de-conta POST] error:", error);
    const message = String(error?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(message)
      ? 401
      : /duplicate|unique|planosdecontagrupos_(codigo|nome)_unique/i.test(message)
        ? 409
        : 500;
    return NextResponse.json(
      { error: status === 409 ? "Já existe um grupo com este código ou nome." : error?.message ?? "Erro ao criar grupo" },
      { status },
    );
  }
}
