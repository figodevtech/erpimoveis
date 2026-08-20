export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";


async function ensureAuth() {
  await requireAuthenticated();
}

export async function GET(req: NextRequest) {
  try {
    await ensureAuth();

    const url = new URL(req.url);
    const ativo = url.searchParams.get("ativo");

    let q = supabaseAdmin
      .from("categoriavenda")
      .select("id, nome, descricao, ativo")
      .order("nome", { ascending: true });

    if (ativo === "true") q = q.eq("ativo", true);
    if (ativo === "false") q = q.eq("ativo", false);

    const { data, error } = await q;
    if (error) throw error;

    const items = (data ?? []).map((c: any) => ({
      id: Number(c.id),
      nome: String(c.nome ?? ""),
      descricao: (c.descricao as string | null) ?? null,
      ativo: typeof c.ativo === "boolean" ? c.ativo : true,
    }));

    return NextResponse.json({ items });
  } catch (e: any) {
    console.error("[/api/tipos/categorias-venda GET] error:", e);
    const msg = String(e?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(msg) ? 401 : 500;
    return NextResponse.json({ error: e?.message ?? "Erro ao carregar categorias de venda" }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureAuth();

    const body = await req.json().catch(() => ({}));
    const { nome, descricao, ativo } = body as {
      nome?: string;
      descricao?: string | null;
      ativo?: boolean;
    };

    if (!nome?.trim()) {
      return NextResponse.json({ error: "Nome da categoria é obrigatório." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const payload = {
      nome: nome.trim().toUpperCase(),
      descricao: descricao?.trim() || null,
      ativo: typeof ativo === "boolean" ? ativo : true,
      createdat: now,
      updatedat: now,
    };

    const { data, error } = await supabaseAdmin
      .from("categoriavenda")
      .insert(payload)
      .select("id, nome, descricao, ativo")
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Falha ao criar categoria." }, { status: 500 });

    const item = {
      id: Number(data.id),
      nome: String(data.nome ?? ""),
      descricao: (data.descricao as string | null) ?? null,
      ativo: typeof data.ativo === "boolean" ? data.ativo : true,
    };

    return NextResponse.json({ item }, { status: 201 });
  } catch (e: any) {
    console.error("[/api/tipos/categorias-venda POST] error:", e);
    const msg = String(e?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(msg)
      ? 401
      : /duplicate|unique|categoriavenda_nome_key/i.test(msg)
      ? 409
      : 500;
    return NextResponse.json({ error: e?.message ?? "Erro ao cadastrar categoria de venda" }, { status });
  }
}
