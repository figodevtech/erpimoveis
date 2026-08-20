// src/app/api/tipos/setores/route.ts
import { NextResponse } from "next/server";
import { requireAuthenticated, requireConfigEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    await requireAuthenticated();
    const { searchParams } = new URL(request.url);
    const all = searchParams.get("all");
    const onlyAtivos = !(all === "1" || all === "true");

    let query = supabase
      .from("setor")
      .select("id,nome,descricao,responsavel,ativo")
      .order("nome", { ascending: true });

    if (onlyAtivos) {
      query = query.eq("ativo", true);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json(
      { items: data ?? [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("GET /api/tipos/setores", err);
    return NextResponse.json(
      { error: "Falha ao listar setores" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    await requireConfigEdit();
    const body = await request.json();
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
      .insert([
        {
          nome,
          descricao,
          responsavel,
          ativo,
        },
      ])
      .select("id,nome,descricao,responsavel,ativo")
      .single();

    if (error) throw error;

    return NextResponse.json(
      { item: data },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("POST /api/tipos/setores", err);
    return NextResponse.json(
      { error: "Falha ao cadastrar setor" },
      { status: 500 }
    );
  }
}
