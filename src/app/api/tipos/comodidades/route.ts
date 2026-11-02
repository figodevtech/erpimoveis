export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { comodidadeFailure, mapComodidade, parseComodidade } from "./shared";

// Leitura liberada a qualquer usuário logado: o formulário do imóvel lista os tipos.
// Criar/editar/excluir passam pelo middleware com tipos:comodidades:<ação>.
export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
    const ativo = new URL(req.url).searchParams.get("ativo");

    let query = supabaseAdmin
      .from("tipos_comodidade")
      .select("id, nome, descricao, ativo")
      .order("nome", { ascending: true });
    if (ativo === "true") query = query.eq("ativo", true);
    if (ativo === "false") query = query.eq("ativo", false);

    const { data, error } = await query;
    if (error) throw error;
    // Ordem alfabética do português (acentos não jogam "Água quente" para o fim).
    const items = (data ?? []).map(mapComodidade).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return NextResponse.json({ items });
  } catch (error) {
    return comodidadeFailure(error, "GET", "Erro ao carregar tipos de comodidade");
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuthenticated();
    const parsed = parseComodidade(await req.json().catch(() => ({})));
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("tipos_comodidade")
      .insert({ ...parsed.value, createdat: now, updatedat: now })
      .select("id, nome, descricao, ativo")
      .single();
    if (error) throw error;
    return NextResponse.json({ item: mapComodidade(data) }, { status: 201 });
  } catch (error) {
    return comodidadeFailure(error, "POST", "Erro ao criar tipo de comodidade");
  }
}
