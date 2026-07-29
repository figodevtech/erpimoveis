// src/app/api/tipos/setores/[id]/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";

// Contexto esperado pelo validator do Next 15
type ParamsCtx = { params: Promise<{ id: string }> };

// PUT /api/tipos/setores/[id] -> atualizar setor inteiro
export async function PUT(request: NextRequest, ctx: ParamsCtx) {
  try {
    const { id } = await ctx.params;
    const setorId = Number(id);

    if (!Number.isFinite(setorId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const nome = (body?.nome ?? "").trim();
    const descricao = (body?.descricao ?? null) as string | null;
    const responsavel = (body?.responsavel ?? null) as string | null;
    const ativo =
      typeof body?.ativo === "boolean" ? (body.ativo as boolean) : true;

    if (!nome) {
      return NextResponse.json(
        { error: "Nome do setor é obrigatório." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("setor")
      .update({
        nome,
        descricao,
        responsavel,
        ativo,
      })
      .eq("id", setorId)
      .select("id,nome,descricao,responsavel,ativo")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return NextResponse.json(
        { error: "Setor não encontrado." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { item: data },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err: any) {
    console.error("PUT /api/tipos/setores/[id]", err);
    return NextResponse.json(
      { error: "Falha ao atualizar setor" },
      { status: 500 }
    );
  }
}

// PATCH /api/tipos/setores/[id] -> atualização parcial
export async function PATCH(request: NextRequest, ctx: ParamsCtx) {
  try {
    const { id } = await ctx.params;
    const setorId = Number(id);

    if (!Number.isFinite(setorId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const patch: any = {};

    if (typeof body?.nome === "string") patch.nome = body.nome.trim();
    if (typeof body?.descricao === "string") {
      patch.descricao = body.descricao.trim() || null;
    }
    if (typeof body?.responsavel === "string") {
      patch.responsavel = body.responsavel.trim() || null;
    }
    if (typeof body?.ativo === "boolean") {
      patch.ativo = body.ativo;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "Nada para atualizar" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("setor")
      .update(patch)
      .eq("id", setorId)
      .select("id,nome,descricao,responsavel,ativo")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return NextResponse.json(
        { error: "Setor não encontrado." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { item: data },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err: any) {
    console.error("PATCH /api/tipos/setores/[id]", err);
    return NextResponse.json(
      { error: "Falha ao atualizar setor" },
      { status: 500 }
    );
  }
}
