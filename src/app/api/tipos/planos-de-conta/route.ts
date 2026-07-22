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
      .select(`
        id,
        codigo,
        nome,
        descricao,
        ativo,
        grupo_id,
        grupo:planosdecontagrupos!planosdeconta_grupo_id_fkey!inner (
          id,
          codigo,
          nome,
          descricao,
          ativo
        )
      `)
      .order("codigo", { ascending: true, nullsFirst: false })
      .order("nome", { ascending: true });
    if (ativo === "true") q = q.eq("ativo", true).eq("grupo.ativo", true);
    if (ativo === "false") q = q.eq("ativo", false);

    const { data, error } = await q;

    if (error) throw error;

    const items =
      (data ?? []).map((c) => ({
        id: c.id as number,
        codigo: (c.codigo as string | null) ?? null,
        nome: c.nome as string,
        descricao: (c.descricao as string | null) ?? null,
        grupo_id: c.grupo_id as number,
        grupo: Array.isArray(c.grupo) ? c.grupo[0] ?? null : c.grupo,
        icone: "other",
        codigo_sistema: null,
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
    const { codigo, nome, descricao, ativo, grupo_id } = body as {
      codigo?: string | null;
      nome?: string;
      descricao?: string | null;
      ativo?: boolean;
      grupo_id?: number | string | null;
    };

    if (!nome?.trim()) {
      return NextResponse.json(
        { error: "Nome do plano de conta é obrigatório." },
        { status: 400 },
      );
    }

    const grupoId = Number(grupo_id);
    if (!Number.isInteger(grupoId) || grupoId <= 0) {
      return NextResponse.json(
        { error: "Grupo do plano de conta é obrigatório." },
        { status: 400 },
      );
    }

    const { data: grupo, error: grupoError } = await supabaseAdmin
      .from("planosdecontagrupos")
      .select("id")
      .eq("id", grupoId)
      .maybeSingle();
    if (grupoError) throw grupoError;
    if (!grupo) {
      return NextResponse.json({ error: "Grupo de plano de conta não encontrado." }, { status: 404 });
    }

    const now = new Date().toISOString();
    const payload = {
      codigo: codigo?.trim() || null,
      nome: nome.trim(),
      descricao: descricao?.trim() || null,
      grupo_id: grupoId,
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
        ativo,
        grupo_id,
        grupo:planosdecontagrupos!planosdeconta_grupo_id_fkey!inner (
          id,
          codigo,
          nome,
          descricao,
          ativo
        )
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
      grupo_id: data.grupo_id as number,
      grupo: Array.isArray(data.grupo) ? data.grupo[0] ?? null : data.grupo,
      icone: "other",
      codigo_sistema: null,
      ativo: typeof data.ativo === "boolean" ? (data.ativo as boolean) : true,
    };

    return NextResponse.json({ item }, { status: 201 });
  } catch (e: any) {
    console.error("[/api/tipos/planos-de-conta POST] error:", e);
    const msg = String(e?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(msg)
      ? 401
      : /duplicate|unique|planosdeconta_(grupo_nome|codigo)_unique/i.test(msg)
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
