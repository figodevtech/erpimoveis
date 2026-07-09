export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireDesmancheAccess, requireDesmancheCreate } from "@/app/api/_authz/perms";

const LOTE_FIELDS =
  "id, placa, modelo, marca, ano, cor, kmatual, tipo, chassi, ano_modelo, versao, fipe, combustivel, transmissao, observacoes, createdat, updatedat";
const LOTE_LIST_FIELDS = `${LOTE_FIELDS}, pecas:lote_pecas(id)`;

function respostaJSON(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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

function sanitizeLotePayload(input: any) {
  const lote = input?.lote ?? input?.novoLote ?? input?.selectedLote ?? input ?? {};

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
    combustivel: toNullableString(lote.combustivel),
    transmissao: toNullableString(lote.transmissao),
    observacoes: toNullableString(lote.observacoes),
  };
}

export async function GET(request: Request) {
  try {
    await requireDesmancheAccess();

    const { searchParams } = new URL(request.url);
    const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 20), 1), 200);
    const search = (searchParams.get("search") ?? searchParams.get("q") ?? "").trim();
    const tipo = (searchParams.get("tipo") ?? "").trim();
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseAdmin
      .from("lotes")
      .select(LOTE_LIST_FIELDS, { count: "exact" })
      .order("id", { ascending: false })
      .range(from, to);

    if (tipo) query = query.eq("tipo", tipo);

    if (search) {
      query = query.or(
        `placa.ilike.%${search}%,modelo.ilike.%${search}%,marca.ilike.%${search}%,chassi.ilike.%${search}%`,
      );
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const total = count ?? 0;
    const items = data ?? [];

    return respostaJSON({
      data: items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        pageCount: items.length,
        hasPrevPage: page > 1,
        hasNextPage: page * limit < total,
      },
      filters: { search, tipo },
    });
  } catch (error: any) {
    console.error("GET /api/lotes", error);
    const status = Number(error?.statusCode ?? 500);
    return respostaJSON({ error: error?.message ?? "Falha ao listar lotes" }, status === 403 ? 403 : 500);
  }
}

export async function POST(request: Request) {
  try {
    await requireDesmancheCreate();

    const body = await request.json().catch(() => null);
    if (!body) return respostaJSON({ error: "JSON inválido no body." }, 400);

    const payload = sanitizeLotePayload(body);

    const { data, error } = await supabaseAdmin.from("lotes").insert(payload).select(LOTE_FIELDS).single();
    if (error) {
      if ((error as any).code === "23505") {
        return respostaJSON({ error: "Já existe um lote com esta placa." }, 409);
      }
      throw error;
    }

    return respostaJSON({ data, id: data.id }, 201);
  } catch (error: any) {
    console.error("POST /api/lotes", error);
    const status = Number(error?.statusCode ?? 500);
    return respostaJSON({ error: error?.message ?? "Falha ao criar lote" }, status === 403 ? 403 : 500);
  }
}
