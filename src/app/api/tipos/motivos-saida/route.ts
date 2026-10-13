export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { MOTIVO_SAIDA_ALUGUEL } from "@/lib/alugueis/status";

const ESCOPOS = new Set(["PRODUTO", "USOCONSUMO", "AMBOS"]);


async function ensureAuth() {
  await requireAuthenticated();
}

/** Deriva um codigo estavel (ex.: "Devolução ao fornecedor" -> "DEVOLUCAO_AO_FORNECEDOR"). */
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
    ativo: typeof row.ativo === "boolean" ? row.ativo : true,
  };
}

export async function GET(req: NextRequest) {
  try {
    await ensureAuth();
    const { searchParams } = new URL(req.url);
    const ativo = searchParams.get("ativo");
    const escopo = searchParams.get("escopo");

    let query = supabaseAdmin
      .from("tipos_motivo_saida")
      .select("id, codigo, nome, descricao, escopo, ativo")
      .order("nome", { ascending: true });
    if (ativo === "true") query = query.eq("ativo", true);
    if (ativo === "false") query = query.eq("ativo", false);
    if (escopo === "PRODUTO" || escopo === "USOCONSUMO") {
      query = query.in("escopo", [escopo, "AMBOS"]);
    }
    // A saída por aluguel nasce no módulo Aluguéis; o diálogo de saída manual
    // não a oferece. O filtro do histórico continua listando o motivo.
    if (searchParams.get("saidaManual") === "1") query = query.neq("codigo", MOTIVO_SAIDA_ALUGUEL);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ items: (data ?? []).map(mapItem) });
  } catch (error: any) {
    console.error("[/api/tipos/motivos-saida GET] error:", error);
    const message = String(error?.message ?? "");
    return NextResponse.json(
      { error: error?.message ?? "Erro ao carregar motivos de saída" },
      { status: /auth|unauth|não autenticado/i.test(message) ? 401 : 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureAuth();
    const body = await req.json().catch(() => ({}));
    const nome = String(body.nome ?? "").trim();
    if (!nome) return NextResponse.json({ error: "Nome do motivo é obrigatório." }, { status: 400 });

    const escopo = String(body.escopo ?? "AMBOS").toUpperCase();
    if (!ESCOPOS.has(escopo)) {
      return NextResponse.json({ error: "Escopo inválido." }, { status: 400 });
    }

    const codigo = slugifyCodigo(nome);
    if (!codigo) return NextResponse.json({ error: "Nome inválido para gerar o código do motivo." }, { status: 400 });

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("tipos_motivo_saida")
      .insert({
        codigo,
        nome,
        descricao: String(body.descricao ?? "").trim() || null,
        escopo,
        ativo: typeof body.ativo === "boolean" ? body.ativo : true,
        createdat: now,
        updatedat: now,
      })
      .select("id, codigo, nome, descricao, escopo, ativo")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Falha ao criar motivo de saída." }, { status: 500 });
    return NextResponse.json({ item: mapItem(data) }, { status: 201 });
  } catch (error: any) {
    console.error("[/api/tipos/motivos-saida POST] error:", error);
    const message = String(error?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(message)
      ? 401
      : /duplicate|unique|tipos_motivo_saida_codigo_unique/i.test(message)
        ? 409
        : 500;
    return NextResponse.json(
      {
        error:
          status === 409
            ? "Já existe um motivo de saída com esse nome (código repetido)."
            : error?.message ?? "Erro ao criar motivo de saída",
      },
      { status },
    );
  }
}
