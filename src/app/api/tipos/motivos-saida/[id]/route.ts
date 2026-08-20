export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ESCOPOS = new Set(["PRODUTO", "USOCONSUMO", "AMBOS"]);


async function ensureAuth() {
  await requireAuthenticated();
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
    ativo: typeof row.ativo === "boolean" ? row.ativo : true,
  };
}

// Codigo nunca é editável aqui de propósito: ele é o valor gravado em
// estoque_saida.motivo/usoconsumo_saida.motivo, então mudar depois da criação
// desincronizaria o histórico já registrado com aquele código.
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureAuth();
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const nome = String(body.nome ?? "").trim();
    if (!nome) return NextResponse.json({ error: "Nome do motivo é obrigatório." }, { status: 400 });

    const payload: Record<string, unknown> = {
      nome,
      descricao: String(body.descricao ?? "").trim() || null,
      updatedat: new Date().toISOString(),
    };
    if (typeof body.ativo === "boolean") payload.ativo = body.ativo;
    if (body.escopo != null) {
      const escopo = String(body.escopo).toUpperCase();
      if (!ESCOPOS.has(escopo)) return NextResponse.json({ error: "Escopo inválido." }, { status: 400 });
      payload.escopo = escopo;
    }

    const { data, error } = await supabaseAdmin
      .from("tipos_motivo_saida")
      .update(payload)
      .eq("id", id)
      .select("id, codigo, nome, descricao, escopo, ativo")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Motivo de saída não encontrado." }, { status: 404 });
    return NextResponse.json({ item: mapItem(data) });
  } catch (error: any) {
    console.error("[/api/tipos/motivos-saida/:id PUT] error:", error);
    const message = String(error?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: error?.message ?? "Erro ao atualizar motivo de saída" }, { status });
  }
}
