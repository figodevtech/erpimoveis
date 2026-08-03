export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ESCOPOS = new Set(["PRODUTO", "USOCONSUMO", "AMBOS"]);
const SELECT = "id, codigo, nome, descricao, escopo, exige_valor, ativo";

function isOpen() {
  const value = String(process.env.OPEN_PERMISSIONS ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "sim"].includes(value);
}

async function ensureAuth() {
  if (!isOpen()) await auth();
}

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function mapItem(row: any) {
  return {
    id: Number(row.id),
    codigo: String(row.codigo ?? ""),
    nome: String(row.nome ?? ""),
    descricao: (row.descricao as string | null) ?? null,
    escopo: String(row.escopo ?? "AMBOS"),
    exigeValor: typeof row.exige_valor === "boolean" ? row.exige_valor : true,
    ativo: typeof row.ativo === "boolean" ? row.ativo : true,
  };
}

// Codigo nunca é editável aqui de propósito: ele é o valor gravado em
// entrada.tipo/usoconsumo_entrada.tipo, então mudar depois da criação
// desincronizaria as entradas já registradas com aquele código.
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureAuth();
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const nome = String(body.nome ?? "").trim();
    if (!nome) return NextResponse.json({ error: "Nome do tipo é obrigatório." }, { status: 400 });

    const payload: Record<string, unknown> = {
      nome,
      descricao: String(body.descricao ?? "").trim() || null,
      updatedat: new Date().toISOString(),
    };
    if (typeof body.ativo === "boolean") payload.ativo = body.ativo;
    if (typeof body.exigeValor === "boolean") payload.exige_valor = body.exigeValor;
    if (body.escopo != null) {
      const escopo = String(body.escopo).toUpperCase();
      if (!ESCOPOS.has(escopo)) return NextResponse.json({ error: "Escopo inválido." }, { status: 400 });
      payload.escopo = escopo;
    }

    const { data, error } = await supabaseAdmin
      .from("tipos_entrada")
      .update(payload)
      .eq("id", id)
      .select(SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Tipo de entrada não encontrado." }, { status: 404 });
    return NextResponse.json({ item: mapItem(data) });
  } catch (error: any) {
    console.error("[/api/tipos/tipos-entrada/:id PUT] error:", error);
    const message = String(error?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: error?.message ?? "Erro ao atualizar tipo de entrada" }, { status });
  }
}
