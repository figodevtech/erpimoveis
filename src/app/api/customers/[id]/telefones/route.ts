// src/app/api/customers/[id]/telefones/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireClientesAccess, requireClientesEdit } from "@/app/api/_authz/perms";

type Params = { params: Promise<{ id: string }> };

const TELEFONE_FIELDS = "id, cliente_id, telefone, contato, observacao";

type TelefoneEntrada = {
  id?: number | null;
  telefone: string;
  contato: string | null;
  observacao: string | null;
};

function parseId(raw: string | undefined) {
  const id = Number((raw ?? "").trim());
  if (!Number.isInteger(id) || id <= 0) throw new Error("ID inválido.");
  return id;
}

function normalizeTexto(v: unknown) {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
}

/**
 * A lista chega inteira do formulário: o que não vier é apagado. Isso mantém
 * o cadastro com um único botão Salvar, sem chamadas por linha editada.
 */
function normalizarLista(body: any): TelefoneEntrada[] {
  const bruto = Array.isArray(body?.telefones) ? body.telefones : null;
  if (!bruto) throw new Error("Informe a lista de telefones.");

  const lista: TelefoneEntrada[] = [];
  const vistos = new Set<string>();

  for (const item of bruto) {
    const telefone = String(item?.telefone ?? "").replace(/\D+/g, "");
    // Linha em branco (o usuário clicou em + e não preencheu) é ignorada.
    if (!telefone && !normalizeTexto(item?.contato) && !normalizeTexto(item?.observacao)) {
      continue;
    }
    if (!/^\d{10,11}$/.test(telefone)) {
      throw new Error("Telefone secundário inválido. Use DDD + número.");
    }
    if (vistos.has(telefone)) {
      throw new Error("Há telefones secundários repetidos na lista.");
    }
    vistos.add(telefone);

    const id = Number(item?.id);
    lista.push({
      id: Number.isInteger(id) && id > 0 ? id : null,
      telefone,
      contato: normalizeTexto(item?.contato),
      observacao: normalizeTexto(item?.observacao),
    });
  }

  return lista;
}

async function listar(clienteId: number) {
  const { data, error } = await supabaseAdmin
    .from("cliente_telefone")
    .select(TELEFONE_FIELDS)
    .eq("cliente_id", clienteId)
    .order("id", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/* ========================= GET ========================= */

export async function GET(_: Request, ctx: Params) {
  try {
    await requireClientesAccess();
    const { id: raw } = await ctx.params;
    const clienteId = parseId(raw);

    return NextResponse.json({ data: await listar(clienteId) });
  } catch (e: any) {
    const msg = e?.message ?? "Erro ao buscar telefones do cliente.";
    return NextResponse.json({ error: msg }, { status: msg.includes("ID inválido") ? 400 : 500 });
  }
}

/* ========================= PUT ========================= */

export async function PUT(req: Request, ctx: Params) {
  try {
    await requireClientesEdit();
    const { id: raw } = await ctx.params;
    const clienteId = parseId(raw);
    const body = await req.json().catch(() => ({}));
    const lista = normalizarLista(body);

    const { data: cliente, error: clienteError } = await supabaseAdmin
      .from("cliente")
      .select("id, telefone")
      .eq("id", clienteId)
      .maybeSingle();

    if (clienteError) throw clienteError;
    if (!cliente) {
      return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    }

    // O principal continua sendo o de `cliente.telefone`; repeti-lo aqui só
    // criaria dois registros para o mesmo número.
    const principal = String(cliente.telefone ?? "").replace(/\D+/g, "");
    if (principal && lista.some((item) => item.telefone === principal)) {
      return NextResponse.json(
        { error: "Este número já é o telefone principal do cliente." },
        { status: 400 }
      );
    }

    // Um id que não seja deste cliente entra como novo, nunca edita o do vizinho.
    const existentes = new Set((await listar(clienteId)).map((item: any) => item.id));
    for (const item of lista) {
      if (item.id != null && !existentes.has(item.id)) item.id = null;
    }

    const manter = lista.map((item) => item.id).filter((id): id is number => id != null);
    const remocao = supabaseAdmin.from("cliente_telefone").delete().eq("cliente_id", clienteId);
    const { error: deleteError } = manter.length
      ? await remocao.not("id", "in", `(${manter.join(",")})`)
      : await remocao;
    if (deleteError) throw deleteError;

    const agora = new Date().toISOString();
    for (const item of lista) {
      if (item.id) {
        const { error } = await supabaseAdmin
          .from("cliente_telefone")
          .update({
            telefone: item.telefone,
            contato: item.contato,
            observacao: item.observacao,
            updated_at: agora,
          })
          .eq("id", item.id)
          .eq("cliente_id", clienteId);
        if (error) throw error;
        continue;
      }

      const { error } = await supabaseAdmin.from("cliente_telefone").insert({
        cliente_id: clienteId,
        telefone: item.telefone,
        contato: item.contato,
        observacao: item.observacao,
      });
      if (error) throw error;
    }

    return NextResponse.json({ data: await listar(clienteId) });
  } catch (e: any) {
    if (e?.code === "23505") {
      return NextResponse.json(
        { error: "Há telefones secundários repetidos na lista." },
        { status: 409 }
      );
    }
    const msg = e?.message ?? "Erro ao salvar telefones do cliente.";
    const invalido =
      msg.includes("ID inválido") ||
      msg.includes("Informe a lista") ||
      msg.includes("Telefone secundário inválido") ||
      msg.includes("repetidos");
    return NextResponse.json({ error: msg }, { status: invalido ? 400 : 500 });
  }
}
