export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";


async function ensureAuth() {
  await requireAuthenticated();
}

function mapItem(row: any) {
  return {
    id: Number(row.id),
    nome: String(row.nome ?? ""),
    descricao: (row.descricao as string | null) ?? null,
    ativo: typeof row.ativo === "boolean" ? row.ativo : true,
    icone: "other",
    codigo_sistema: null,
  };
}

export async function GET(req: NextRequest) {
  try {
    await ensureAuth();
    const ativo = new URL(req.url).searchParams.get("ativo");
    let query = supabaseAdmin
      .from("centrosdecusto")
      .select("id, nome, descricao, ativo")
      .order("nome", { ascending: true });
    if (ativo === "true") query = query.eq("ativo", true);
    if (ativo === "false") query = query.eq("ativo", false);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ items: (data ?? []).map(mapItem) });
  } catch (error: any) {
    console.error("[/api/tipos/centros-de-custo GET] error:", error);
    const message = String(error?.message ?? "");
    return NextResponse.json(
      { error: error?.message ?? "Erro ao carregar centros de custo" },
      { status: /auth|unauth|não autenticado/i.test(message) ? 401 : 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureAuth();
    const body = await req.json().catch(() => ({}));
    const nome = String(body.nome ?? "").trim();
    if (!nome) return NextResponse.json({ error: "Nome do centro de custo é obrigatório." }, { status: 400 });

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("centrosdecusto")
      .insert({
        nome,
        descricao: String(body.descricao ?? "").trim() || null,
        ativo: typeof body.ativo === "boolean" ? body.ativo : true,
        createdat: now,
        updatedat: now,
      })
      .select("id, nome, descricao, ativo")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Falha ao criar centro de custo." }, { status: 500 });
    return NextResponse.json({ item: mapItem(data) }, { status: 201 });
  } catch (error: any) {
    console.error("[/api/tipos/centros-de-custo POST] error:", error);
    const message = String(error?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(message)
      ? 401
      : /duplicate|unique|centrosdecusto_nome_unique/i.test(message)
        ? 409
        : 500;
    return NextResponse.json(
      { error: status === 409 ? "Já existe um centro de custo com este nome." : error?.message ?? "Erro ao criar centro de custo" },
      { status },
    );
  }
}
