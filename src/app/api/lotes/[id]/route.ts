export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  requireDesmancheAccess,
  requireDesmancheDelete,
  requireDesmancheEdit,
} from "@/app/api/_authz/perms";
import { carregarResumoPecasLote } from "@/services/desmanche/lote-pecas-service";

const LOTE_FIELDS = `
  id, placa, modelo, marca, ano, cor, kmatual, tipo, chassi, ano_modelo, versao, fipe, valor_compra, combustivel, transmissao, observacoes, "imgUrl", createdat, updatedat
`;

function respostaJSON(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function idValido(raw: string) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizarPlaca(valor: unknown) {
  const placa = String(valor ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return placa || null;
}

function toNullableString(value: unknown, upper = false) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return upper ? text.toUpperCase() : text;
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeLotePatch(input: any) {
  const lote = input?.lote ?? input?.selectedLote ?? input ?? {};

  return {
    placa: normalizarPlaca(lote.placa),
    modelo: toNullableString(lote.modelo),
    marca: toNullableString(lote.marca),
    ano: toNullableNumber(lote.ano),
    cor: toNullableString(lote.cor),
    kmatual: toNullableNumber(lote.kmatual),
    tipo: toNullableString(lote.tipo),
    chassi: toNullableString(lote.chassi, true),
    ano_modelo: toNullableNumber(lote.ano_modelo),
    versao: toNullableString(lote.versao),
    fipe: toNullableNumber(lote.fipe),
    valor_compra: Math.max(0, toNullableNumber(lote.valor_compra) ?? 0),
    combustivel: toNullableString(lote.combustivel),
    transmissao: toNullableString(lote.transmissao),
    observacoes: toNullableString(lote.observacoes),
    updatedat: new Date().toISOString(),
  };
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await requireDesmancheAccess();

    const { id: rawId } = await ctx.params;
    const id = idValido(rawId);
    if (!id) return respostaJSON({ error: "Parâmetro 'id' inválido." }, 400);

    const { data, error } = await supabaseAdmin.from("lotes").select(LOTE_FIELDS).eq("id", id).single();
    if (error) return respostaJSON({ error: "Lote não encontrado." }, 404);

    const resumoPecas = await carregarResumoPecasLote(id, data.valor_compra);
    return respostaJSON({ lote: { ...data, ...resumoPecas } });
  } catch (error: any) {
    console.error("GET /api/lotes/[id]", error);
    const status = Number(error?.statusCode ?? 500);
    return respostaJSON({ error: error?.message ?? "Falha ao buscar lote" }, status === 403 ? 403 : 500);
  }
}

export async function PUT(request: Request, ctx: Ctx) {
  try {
    await requireDesmancheEdit();

    const { id: rawId } = await ctx.params;
    const id = idValido(rawId);
    if (!id) return respostaJSON({ error: "Parâmetro 'id' inválido." }, 400);

    const body = await request.json().catch(() => null);
    if (!body) return respostaJSON({ error: "JSON inválido no body." }, 400);

    const patch = sanitizeLotePatch(body);

    const { data, error } = await supabaseAdmin
      .from("lotes")
      .update(patch)
      .eq("id", id)
      .select('id, placa, modelo, marca, ano, cor, kmatual, tipo, chassi, ano_modelo, versao, fipe, valor_compra, combustivel, transmissao, observacoes, "imgUrl", createdat, updatedat')
      .single();

    if (error) {
      if ((error as any).code === "23505") {
        return respostaJSON({ error: "Já existe um lote com esta placa." }, 409);
      }
      throw error;
    }

    return respostaJSON({ lote: data });
  } catch (error: any) {
    console.error("PUT /api/lotes/[id]", error);
    const status = Number(error?.statusCode ?? 500);
    return respostaJSON({ error: error?.message ?? "Falha ao atualizar lote" }, status === 403 ? 403 : 500);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    await requireDesmancheDelete();

    const { id: rawId } = await ctx.params;
    const id = idValido(rawId);
    if (!id) return respostaJSON({ error: "Parâmetro 'id' inválido." }, 400);

    const { error } = await supabaseAdmin.from("lotes").delete().eq("id", id);
    if (error) throw error;

    return respostaJSON({ ok: true });
  } catch (error: any) {
    console.error("DELETE /api/lotes/[id]", error);
    const status = Number(error?.statusCode ?? 500);
    return respostaJSON({ error: error?.message ?? "Falha ao remover lote" }, status === 403 ? 403 : 500);
  }
}
