// src/app/api/customers/[id]/saldo/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireClientesAccess, requireFinanceiroEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Params = { params: Promise<{ id: string }> };

const MOVIMENTO_FIELDS =
  "id, sentido, origem, acao, valor, saldo_anterior, saldo_resultante, transacao_id, motivo, created_by, created_at, updated_by, updated_at, transacao:transacao_id(ordemservicoid, vendaid)";

type MovimentoBruto = {
  created_by: string | null;
  updated_by: string | null;
  transacao: { ordemservicoid: number | null; vendaid: number | null } | null;
  [campo: string]: unknown;
};

/** Nome de quem lançou e de quem editou. Sem join: `created_by` não é FK de `usuario`. */
async function carregarUsuarios(ids: Array<string | null>): Promise<Map<string, string>> {
  const unicos = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  const mapa = new Map<string, string>();
  if (unicos.length === 0) return mapa;

  const { data, error } = await supabaseAdmin.from("usuario").select("id, nome").in("id", unicos);
  if (error) throw error;
  for (const linha of data ?? []) mapa.set(String(linha.id), String(linha.nome ?? ""));
  return mapa;
}

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 200;

function parseId(raw: string | undefined) {
  const id = Number((raw ?? "").trim());
  if (!Number.isInteger(id) || id <= 0) throw new Error("ID inválido.");
  return id;
}

/* ========================= GET ========================= */

/**
 * Saldo atual e extrato do crédito do cliente.
 *
 * Ver o saldo é parte de ver o cadastro, então basta a permissão de clientes.
 * Mexer nele é outra conversa — ver o POST abaixo.
 */
export async function GET(req: Request, ctx: Params) {
  try {
    await requireClientesAccess();
    const { id: raw } = await ctx.params;
    const clienteId = parseId(raw);

    const url = new URL(req.url);
    const limite = Math.min(
      Math.max(Number(url.searchParams.get("limit")) || LIMITE_PADRAO, 1),
      LIMITE_MAXIMO,
    );
    const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

    const { data: cliente, error: clienteError } = await supabaseAdmin
      .from("cliente")
      .select("id, saldo_credito")
      .eq("id", clienteId)
      .maybeSingle();

    if (clienteError) throw clienteError;
    if (!cliente) {
      return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    }

    const {
      data: movimentos,
      error: movimentosError,
      count,
    } = await supabaseAdmin
      .from("cliente_saldo_movimento")
      .select(MOVIMENTO_FIELDS, { count: "exact" })
      .eq("cliente_id", clienteId)
      .order("id", { ascending: false })
      .range(offset, offset + limite - 1);

    if (movimentosError) throw movimentosError;

    const linhas = (movimentos ?? []) as unknown as MovimentoBruto[];
    const usuarios = await carregarUsuarios(linhas.flatMap((m) => [m.created_by, m.updated_by]));

    // O documento por trás da baixa vem achatado: a tela só quer saber se há
    // OS ou venda para abrir, não a transação inteira.
    const enriquecidos = linhas.map(({ transacao, ...movimento }) => ({
      ...movimento,
      created_by_nome: movimento.created_by ? usuarios.get(movimento.created_by) || null : null,
      updated_by_nome: movimento.updated_by ? usuarios.get(movimento.updated_by) || null : null,
      ordemservico_id: transacao?.ordemservicoid ?? null,
      venda_id: transacao?.vendaid ?? null,
    }));

    return NextResponse.json({
      data: {
        saldo: Number(cliente.saldo_credito ?? 0),
        movimentos: enriquecidos,
        total: count ?? 0,
      },
    });
  } catch (e: any) {
    const msg = e?.message ?? "Erro ao buscar o crédito do cliente.";
    const statusCode = Number(e?.statusCode);
    if (statusCode === 401 || statusCode === 403) {
      return NextResponse.json({ error: msg }, { status: statusCode });
    }
    return NextResponse.json({ error: msg }, { status: msg.includes("ID inválido") ? 400 : 500 });
  }
}

/* ========================= POST ========================= */

/**
 * Ajuste manual do crédito: adiciona ou remove saldo da carteira.
 *
 * Exige permissão do FINANCEIRO, não a de clientes. Criar crédito é criar
 * dinheiro que vai quitar cobrança depois — é a mesma régua de baixar, estornar
 * e abonar. Quem só cuida do cadastro consegue ver o saldo (GET acima), mas não
 * mexer nele.
 */
export async function POST(req: Request, ctx: Params) {
  try {
    await requireFinanceiroEdit();
    const session = await auth();
    const { id: raw } = await ctx.params;
    const clienteId = parseId(raw);

    const body = await req.json().catch(() => ({}));
    const sentido = String(body?.sentido ?? "").trim().toUpperCase();
    const valor = Number(body?.valor);
    const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : null;

    if (sentido !== "CREDITO" && sentido !== "DEBITO") {
      return NextResponse.json(
        { error: "Informe se o ajuste adiciona (CREDITO) ou remove (DEBITO) saldo." },
        { status: 400 },
      );
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json(
        { error: "O valor do ajuste deve ser maior que zero." },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin.rpc("ajustar_saldo_credito_cliente", {
      p_cliente_id: clienteId,
      p_sentido: sentido,
      p_valor: valor,
      p_motivo: motivo || null,
      p_usuario: (session?.user as any)?.id ?? null,
    });

    if (error) {
      // Saldo insuficiente e valor inválido chegam com a mensagem pronta da RPC.
      if (error.code === "22023") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === "P0002") {
        return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({ data });
  } catch (e: any) {
    const msg = e?.message ?? "Não foi possível ajustar o crédito do cliente.";
    const statusCode = Number(e?.statusCode);
    if (statusCode === 401 || statusCode === 403) {
      return NextResponse.json({ error: msg }, { status: statusCode });
    }
    return NextResponse.json({ error: msg }, { status: msg.includes("ID inválido") ? 400 : 500 });
  }
}
