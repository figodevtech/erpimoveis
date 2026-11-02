import { NextResponse } from "next/server";

export type Comodidade = { id: number; nome: string; descricao: string | null; ativo: boolean };

export function mapComodidade(row: any): Comodidade {
  return {
    id: Number(row.id),
    nome: String(row.nome ?? ""),
    descricao: (row.descricao as string | null) ?? null,
    ativo: typeof row.ativo === "boolean" ? row.ativo : true,
  };
}

/** Mesmo limite de imovel.comodidades no schema do imóvel (120 caracteres por item). */
export function parseComodidade(body: any): { value: { nome: string; descricao: string | null; ativo: boolean } } | { error: string } {
  const nome = String(body?.nome ?? "").trim().replace(/\s+/g, " ");
  if (!nome) return { error: "Nome da comodidade é obrigatório." };
  if (nome.length > 120) return { error: "O nome da comodidade pode ter no máximo 120 caracteres." };
  const descricao = String(body?.descricao ?? "").trim().slice(0, 300) || null;
  return { value: { nome, descricao, ativo: typeof body?.ativo === "boolean" ? body.ativo : true } };
}

export function comodidadeFailure(error: any, method: string, fallback: string) {
  console.error(`[/api/tipos/comodidades ${method}] error:`, error);
  const message = String(error?.message ?? "");
  if (/auth|unauth|não autenticado/i.test(message)) return NextResponse.json({ error: message || fallback }, { status: 401 });
  if (error?.code === "23505" || /duplicate|unique/i.test(message))
    return NextResponse.json({ error: "Já existe um tipo de comodidade com esse nome." }, { status: 409 });
  return NextResponse.json({ error: message || fallback }, { status: 500 });
}
