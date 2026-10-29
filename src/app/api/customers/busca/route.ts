export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { idDeBusca } from "@/lib/busca-numerica";
import { requireClientesAccess } from "@/app/api/_authz/perms";

type Status = "ATIVO" | "INATIVO" | "PENDENTE";
const STATUS_SET = new Set<Status>(["ATIVO", "INATIVO", "PENDENTE"]);

function removeAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/* ============================
   GET /api/customers/busca (listar/buscar para os seletores de cliente)
   ============================ */
export async function GET(req: Request) {
  try {
    await requireClientesAccess();
    const { searchParams } = new URL(req.url);

    const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
    const limitRaw =
      searchParams.get("limit") ?? searchParams.get("pageSize") ?? "20";
    const limit = Math.min(Math.max(Number(limitRaw), 1), 100);

    const rawQ = (
      searchParams.get("search") ??
      searchParams.get("q") ??
      ""
    ).trim();

    // O Consumidor Final só serve à venda: as demais telas nem o veem na busca.
    const incluirConsumidorFinal = searchParams.get("consumidorFinal") === "1";
    const tipopessoaParam = (searchParams.get("tipopessoa") ?? "").toUpperCase();
    const statusParam = (searchParams.get("status") ?? "TODOS").toUpperCase();
    const statusFilter = STATUS_SET.has(statusParam as Status)
      ? (statusParam as Status)
      : null;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let isExactIdOnly = false;
    let cleanQ = rawQ;

    if (/^#\s*\d+$/.test(rawQ)) {
      isExactIdOnly = true;
      cleanQ = rawQ.replace(/^#\s*/, "");
    } else if (/^id:\s*\d+$/i.test(rawQ)) {
      isExactIdOnly = true;
      cleanQ = rawQ.replace(/^id:\s*/i, "");
    } else if (/^id=\s*\d+$/i.test(rawQ)) {
      isExactIdOnly = true;
      cleanQ = rawQ.replace(/^id=\s*/i, "");
    }

    let query = supabaseAdmin
      .from("cliente")
      .select(
        `
        id, tipopessoa, cpfcnpj, nomerazaosocial, email, telefone, endereco,
        cidade, estado, bairro, cep, inscricaoestadual, inscricaomunicipal, codigomunicipio,
        ind_ie_dest,
        createdat, updatedat, endereconumero, enderecocomplemento, status, codigo_sistema
        `,
        { count: "exact" }
      )
      .order("id", { ascending: false });

    if (cleanQ) {
      if (isExactIdOnly) {
        query = query.eq("id", Number(cleanQ));
      } else {
        const onlyDigitsQ = cleanQ.replace(/\D+/g, "");
        const unaccentedQ = removeAccents(cleanQ);
        const hasDiffAccents = unaccentedQ !== cleanQ.toLowerCase();
        const isNumeric = /^\d+$/.test(cleanQ);

        const conditions: string[] = [];
        const idNumerico = isNumeric ? idDeBusca(cleanQ) : null;

        if (idNumerico !== null) {
          conditions.push(`id.eq.${idNumerico}`);
        }

        conditions.push(`nomerazaosocial.ilike.%${cleanQ}%`);
        conditions.push(`cpfcnpj.ilike.%${cleanQ}%`);
        conditions.push(`email.ilike.%${cleanQ}%`);
        conditions.push(`telefone.ilike.%${cleanQ}%`);
        conditions.push(`cidade.ilike.%${cleanQ}%`);

        if (hasDiffAccents) {
          conditions.push(`nomerazaosocial.ilike.%${unaccentedQ}%`);
          conditions.push(`cidade.ilike.%${unaccentedQ}%`);
        }

        if (onlyDigitsQ && onlyDigitsQ.length >= 3 && onlyDigitsQ !== cleanQ) {
          conditions.push(`cpfcnpj.ilike.%${onlyDigitsQ}%`);
          conditions.push(`telefone.ilike.%${onlyDigitsQ}%`);
        }

        query = query.or(conditions.join(","));
      }
    }

    if (!incluirConsumidorFinal) {
      query = query.is("codigo_sistema", null);
    }

    if (tipopessoaParam === "FISICA" || tipopessoaParam === "JURIDICA") {
      query = query.eq("tipopessoa", tipopessoaParam);
    }

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    const items = data ?? [];

    // Prioriza ID exato no topo se for busca por ID/número
    if (cleanQ && /^\d+$/.test(cleanQ)) {
      const targetId = Number(cleanQ);
      const exactIndex = items.findIndex((item) => Number(item.id) === targetId);
      if (exactIndex > 0) {
        const [exactItem] = items.splice(exactIndex, 1);
        items.unshift(exactItem);
      }
    }

    const total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const pageCount = items.length;
    const hasPrevPage = page > 1;
    const hasNextPage = page * limit < total;

    return NextResponse.json({
      data: items,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        pageCount,
        hasPrevPage,
        hasNextPage,
      },
      filters: { search: rawQ, status: statusFilter ?? "TODOS", tipopessoa: tipopessoaParam || "TODOS" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Erro ao listar clientes" },
      { status: 500 }
    );
  }
}
