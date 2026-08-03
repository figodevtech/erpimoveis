export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ESCOPOS = new Set(["PRODUTO", "USOCONSUMO", "AMBOS"]);

function isOpen() {
  const value = String(process.env.OPEN_PERMISSIONS ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "sim"].includes(value);
}

async function ensureAuth() {
  if (!isOpen()) await auth();
}

/** Deriva um codigo estavel (ex.: "Retorno de garantia" -> "RETORNO_DE_GARANTIA"). */
function slugifyCodigo(nome: string) {
  return nome
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

const SELECT = "id, codigo, nome, descricao, escopo, exige_valor, ativo";

export async function GET(req: NextRequest) {
  try {
    await ensureAuth();
    const { searchParams } = new URL(req.url);
    const ativo = searchParams.get("ativo");
    const escopo = searchParams.get("escopo");

    let query = supabaseAdmin.from("tipos_entrada").select(SELECT).order("nome", { ascending: true });
    if (ativo === "true") query = query.eq("ativo", true);
    if (ativo === "false") query = query.eq("ativo", false);
    if (escopo === "PRODUTO" || escopo === "USOCONSUMO") {
      query = query.in("escopo", [escopo, "AMBOS"]);
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ items: (data ?? []).map(mapItem) });
  } catch (error: any) {
    console.error("[/api/tipos/tipos-entrada GET] error:", error);
    const message = String(error?.message ?? "");
    return NextResponse.json(
      { error: error?.message ?? "Erro ao carregar tipos de entrada" },
      { status: /auth|unauth|não autenticado/i.test(message) ? 401 : 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureAuth();
    const body = await req.json().catch(() => ({}));
    const nome = String(body.nome ?? "").trim();
    if (!nome) return NextResponse.json({ error: "Nome do tipo é obrigatório." }, { status: 400 });

    const escopo = String(body.escopo ?? "AMBOS").toUpperCase();
    if (!ESCOPOS.has(escopo)) {
      return NextResponse.json({ error: "Escopo inválido." }, { status: 400 });
    }

    const codigo = slugifyCodigo(nome);
    if (!codigo) return NextResponse.json({ error: "Nome inválido para gerar o código do tipo." }, { status: 400 });

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("tipos_entrada")
      .insert({
        codigo,
        nome,
        descricao: String(body.descricao ?? "").trim() || null,
        escopo,
        exige_valor: typeof body.exigeValor === "boolean" ? body.exigeValor : true,
        ativo: typeof body.ativo === "boolean" ? body.ativo : true,
        createdat: now,
        updatedat: now,
      })
      .select(SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Falha ao criar tipo de entrada." }, { status: 500 });
    return NextResponse.json({ item: mapItem(data) }, { status: 201 });
  } catch (error: any) {
    console.error("[/api/tipos/tipos-entrada POST] error:", error);
    const message = String(error?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(message)
      ? 401
      : /duplicate|unique|tipos_entrada_codigo_unique/i.test(message)
        ? 409
        : 500;
    return NextResponse.json(
      {
        error:
          status === 409
            ? "Já existe um tipo de entrada com esse nome (código repetido)."
            : error?.message ?? "Erro ao criar tipo de entrada",
      },
      { status },
    );
  }
}
