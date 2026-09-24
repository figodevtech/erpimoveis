// src/app/api/tipos/fornecedores/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAuthenticated, requirePerm } from "@/app/api/_authz/perms";
import { tipoPermission } from "@/app/api/_authz/permission-constants";
import {
  isValidCnpj,
  isValidCpf,
  normalizeCpfOrCnpj,
} from "@/lib/fiscal-identifiers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { idDeBusca } from "@/lib/busca-numerica";


async function ensureAuth() {
  await requireAuthenticated();
}

function removeAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const searchableColumns = [
  "cpfcnpj",
  "inscricaoestadual",
  "nomerazaosocial",
  "nomefantasia",
  "endereco",
  "endereconumero",
  "enderecocomplemento",
  "cidade",
  "bairro",
  "codigomunicipio",
  "estado",
  "cep",
  "contato",
];

function searchConditions(value: string): string[] {
  // Valores do filtro OR seguem a sintaxe do PostgREST; aspas preservam pontuação da busca.
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return searchableColumns.map((column) => `${column}.ilike."%${escaped}%"`);
}

// GET /api/tipos/fornecedores
export async function GET(req: Request) {
  try {
    await ensureAuth();

    const url = new URL(req.url);

    // pagination
    const pageParam = url.searchParams.get("page");
    const limitParam = url.searchParams.get("limit");
    const rawQ = (url.searchParams.get("search") ?? url.searchParams.get("q") ?? "").trim();

    let page = Number(pageParam || "1");
    let limit = Number(limitParam || "20");

    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 20;
    // limite de segurança
    if (limit > 100) limit = 100;

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

    // base query
    let query = supabaseAdmin
      .from("fornecedor")
      .select(
        `
        id,
        cpfcnpj,
        inscricaoestadual,
        nomerazaosocial,
        nomefantasia,
        endereco,
        endereconumero,
        cidade,
        bairro,
        codigomunicipio,
        estado,
        cep,
        contato,
        ativo
      `,
        { count: "exact" }
      )
      .order("id", { ascending: false });

    // filtro de busca
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

        conditions.push(...searchConditions(cleanQ));

        if (hasDiffAccents) {
          conditions.push(...searchConditions(unaccentedQ));
        }

        if (onlyDigitsQ && onlyDigitsQ.length >= 3 && onlyDigitsQ !== cleanQ) {
          conditions.push(...searchConditions(onlyDigitsQ));
        }

        if (unaccentedQ === "ativo") conditions.push("ativo.eq.true");
        if (unaccentedQ === "inativo") conditions.push("ativo.eq.false");

        query = query.or(conditions.join(","));
      }
    }

    const { data, error, count } = await query.range(from, to);

    if (error) throw error;

    const items = (data ?? []).map((f: any) => ({
      id: f.id as number,
      cpfcnpj: f.cpfcnpj as string,
      inscricaoestadual: (f.inscricaoestadual as string | null) ?? null,
      nomerazaosocial: f.nomerazaosocial as string,
      nomefantasia: (f.nomefantasia as string | null) ?? null,
      endereco: (f.endereco as string | null) ?? null,
      endereconumero: (f.endereconumero as string | null) ?? null,
      cidade: (f.cidade as string | null) ?? null,
      bairro: (f.bairro as string | null) ?? null,
      codigomunicipio: (f.codigomunicipio as string | null) ?? null,
      estado: (f.estado as string | null) ?? null,
      cep: (f.cep as string | null) ?? null,
      contato: (f.contato as string | null) ?? null,
      ativo: typeof f.ativo === "boolean" ? f.ativo : true,
    }));

    // Prioriza ID exato no topo se for busca numérica
    if (cleanQ && /^\d+$/.test(cleanQ)) {
      const targetId = Number(cleanQ);
      const exactIndex = items.findIndex((item) => Number(item.id) === targetId);
      if (exactIndex > 0) {
        const [exactItem] = items.splice(exactIndex, 1);
        items.unshift(exactItem);
      }
    }

    const total = count ?? 0;
    const totalPages =
      limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
    const pageCount = items.length;

    const pagination = {
      total,
      page,
      limit,
      totalPages,
      pageCount,
    };

    return NextResponse.json({ items, pagination });
  } catch (e: any) {
    console.error("[/api/tipos/fornecedores GET] error:", e);
    const status = /auth|unauth|não autenticado/i.test(String(e?.message)) ? 401 : 500;
    return NextResponse.json(
      { error: e?.message ?? "Erro ao carregar fornecedores" },
      { status }
    );
  }
}

// POST /api/tipos/fornecedores
export async function POST(req: Request) {
  try {
    await ensureAuth();
    await requirePerm(tipoPermission("fornecedores", "criar"));

    const body = await req.json().catch(() => ({}));
    const {
      cpfcnpj,
      inscricaoestadual,
      nomerazaosocial,
      nomefantasia,
      endereco,
      endereconumero,
      cidade,
      bairro,
      codigomunicipio,
      estado,
      cep,
      contato,
    }: {
      cpfcnpj?: string;
      inscricaoestadual?: string | null;
      nomerazaosocial?: string;
      nomefantasia?: string | null;
      endereco?: string | null;
      endereconumero?: string | null;
      cidade?: string | null;
      bairro?: string | null;
      codigomunicipio?: string | null;
      estado?: string | null;
      cep?: string | null;
      contato?: string | null;
    } = body ?? {};

    const documento = normalizeCpfOrCnpj(cpfcnpj);

    if (!(isValidCpf(documento) || isValidCnpj(documento))) {
      return NextResponse.json(
        { error: "Digite um CPF ou CNPJ válido." },
        { status: 400 }
      );
    }

    if (!nomerazaosocial?.trim()) {
      return NextResponse.json(
        { error: "Razão Social ou Nome é obrigatória." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const payload = {
      cpfcnpj: documento,
      inscricaoestadual: inscricaoestadual?.trim() || null,
      nomerazaosocial: nomerazaosocial.trim(),
      nomefantasia: nomefantasia?.trim() || null,
      endereco: endereco?.trim() || null,
      endereconumero: endereconumero?.trim() || null,
      cidade: cidade?.trim() || null,
      bairro: bairro?.trim() || null,
      codigomunicipio: codigomunicipio?.trim() || null,
      estado: estado?.trim() || null,
      cep: cep?.trim() || null,
      contato: contato?.trim() || null,
      ativo: true,
      updatedat: now,
    };

    const { data, error } = await supabaseAdmin
      .from("fornecedor")
      .insert(payload)
      .select(`
        id,
        cpfcnpj,
        inscricaoestadual,
        nomerazaosocial,
        nomefantasia,
        endereco,
        endereconumero,
        cidade,
        bairro,
        codigomunicipio,
        estado,
        cep,
        contato,
        ativo
      `)
      .single();

    if (error) throw error;

    const item = {
      id: data!.id as number,
      cpfcnpj: data!.cpfcnpj as string,
      inscricaoestadual: (data!.inscricaoestadual as string | null) ?? null,
      nomerazaosocial: data!.nomerazaosocial as string,
      nomefantasia: (data!.nomefantasia as string | null) ?? null,
      endereco: (data!.endereco as string | null) ?? null,
      cidade: (data!.cidade as string | null) ?? null,
      endereconumero: (data!.endereconumero as string | null) ?? null,
      bairro: (data!.bairro as string | null) ?? null,
      codigomunicipio: (data!.codigomunicipio as string | null) ?? null,
      estado: (data!.estado as string | null) ?? null,
      cep: (data!.cep as string | null) ?? null,
      contato: (data!.contato as string | null) ?? null,
      ativo: typeof data!.ativo === "boolean" ? data!.ativo : true,
    };

    return NextResponse.json({ item }, { status: 201 });
  } catch (e: any) {
    console.error("[/api/tipos/fornecedores POST] error:", e);

    const msg = String(e?.message ?? "");
    const status =
      e?.statusCode === 403 ? 403 :
        /auth|unauth|não autenticado/i.test(msg) ? 401 :
        /duplicate|unique|fornecedor_cnpj_key/i.test(msg) ? 409 :
          500;

    return NextResponse.json(
      { error: e?.message ?? "Erro ao salvar fornecedor" },
      { status }
    );
  }
}
