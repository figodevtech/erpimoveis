export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAlugueisAccess, requireAlugueisCreate } from "@/app/api/_authz/perms";
import { filtroDaAba, hojeAluguel, parseAbaAluguel } from "@/lib/alugueis/status";
import { SELECT_LISTA_ALUGUEL, respostaDeErro, usuarioDaSessao } from "@/lib/alugueis/server";

/** Mesmo saneamento da lista de OS: tira o que quebra o `.or()` do PostgREST. */
function sanitizarTermo(valor: string) {
  return valor
    .replace(/[%_(),"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

const ORDENACOES: Record<string, string> = {
  id: "id",
  inicio: "data_inicio",
  limite: "data_limite",
  valor: "valor_total",
  criado: "created_at",
};

/**
 * Busca por #id, cliente (cadastrado ou avulso), documento, item ou placa.
 * Itens e cliente cadastrado vivem em outras tabelas: os ids que casam com eles
 * entram no `.or()` como `id.in.(...)`.
 */
async function idsQueCasam(q: string): Promise<number[]> {
  const termo = `%${q}%`;
  const [itens, clientes] = await Promise.all([
    supabaseAdmin
      .from("aluguel_item")
      .select("aluguel_id")
      .or(`descricao.ilike.${termo},identificacao.ilike.${termo}`)
      .limit(500),
    supabaseAdmin
      .from("cliente")
      .select("id")
      .or(`nomerazaosocial.ilike.${termo},cpfcnpj.ilike.${termo}`)
      .limit(500),
  ]);
  if (itens.error) throw itens.error;
  if (clientes.error) throw clientes.error;

  const ids = new Set<number>((itens.data ?? []).map((row) => Number(row.aluguel_id)));
  const clienteIds = (clientes.data ?? []).map((row) => Number(row.id));
  if (clienteIds.length) {
    const doCliente = await supabaseAdmin
      .from("aluguel")
      .select("id")
      .in("cliente_id", clienteIds)
      .limit(500);
    if (doCliente.error) throw doCliente.error;
    for (const row of doCliente.data ?? []) ids.add(Number(row.id));
  }
  return [...ids];
}

export async function GET(req: NextRequest) {
  try {
    await requireAlugueisAccess();
    const params = req.nextUrl.searchParams;
    const page = Math.max(Number(params.get("page")) || 1, 1);
    const limit = Math.min(Math.max(Number(params.get("limit")) || 25, 1), 200);
    const from = (page - 1) * limit;
    const aba = parseAbaAluguel(params.get("aba"));
    const filtro = filtroDaAba(aba, hojeAluguel());

    let query = supabaseAdmin
      .from("aluguel")
      .select(SELECT_LISTA_ALUGUEL, { count: "exact" })
      .eq("is_deleted", false);

    if (filtro.status) query = query.eq("status", filtro.status);
    if (filtro.limiteDesde) query = query.gte("data_limite", filtro.limiteDesde);
    if (filtro.limiteAntesDe) query = query.lt("data_limite", filtro.limiteAntesDe);

    const qBruto = String(params.get("q") ?? "").trim();
    if (qBruto) {
      const numero = /^#?\d+$/.test(qBruto) ? Number(qBruto.replace("#", "")) : null;
      const q = sanitizarTermo(qBruto.replace(/^#/, ""));
      if (numero !== null && qBruto.startsWith("#")) {
        query = query.eq("id", numero);
      } else if (q) {
        const termo = `%${q}%`;
        const ids = await idsQueCasam(q);
        if (numero !== null) ids.push(numero);
        const condicoes = [`cliente_nome.ilike.${termo}`, `cliente_documento.ilike.${termo}`, `observacao.ilike.${termo}`];
        if (ids.length) condicoes.push(`id.in.(${ids.join(",")})`);
        query = query.or(condicoes.join(","));
      }
    }

    const coluna = ORDENACOES[String(params.get("sort") ?? "")] ?? "id";
    const ascending = String(params.get("dir") ?? (coluna === "id" ? "desc" : "asc")).toLowerCase() === "asc";
    query = query.order(coluna, { ascending });
    if (coluna !== "id") query = query.order("id", { ascending: false });

    const { data, error, count } = await query.range(from, from + limit - 1);
    if (error) throw error;

    const total = count ?? 0;
    return NextResponse.json({
      items: data ?? [],
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    return respostaDeErro(error, "Erro ao listar aluguéis.");
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAlugueisCreate();
    const usuario = await usuarioDaSessao();
    // Criar nunca edita: um `id` vindo no corpo é descartado.
    const payload = { ...((await req.json().catch(() => ({}))) ?? {}) };
    delete payload.id;

    const { data, error } = await supabaseAdmin.rpc("aluguel_salvar", {
      p_payload: payload,
      p_usuario: usuario,
    });
    if (error) throw error;
    return NextResponse.json({ id: Number(data) }, { status: 201 });
  } catch (error) {
    return respostaDeErro(error, "Erro ao criar aluguel.");
  }
}
