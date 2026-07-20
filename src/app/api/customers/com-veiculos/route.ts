// src/app/api/customers/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireClientesAccess, requireClientesCreate } from "@/app/api/_authz/perms";

type Status = "ATIVO" | "INATIVO" | "PENDENTE";
const STATUS_SET = new Set<Status>(["ATIVO", "INATIVO", "PENDENTE"]);

const CLIENTE_FIELDS = `
  id, tipopessoa, cpfcnpj, nomerazaosocial, email, telefone, endereco,
  cidade, estado, bairro, cep, inscricaoestadual, inscricaomunicipal, codigomunicipio,
  createdat, updatedat, endereconumero, enderecocomplemento, status
`;

const VEICULO_FIELDS = `
  id, clienteid, placa, placa_formatada, modelo, marca, ano, cor, kmatual, tipo, createdat, updatedat
`;

function onlyDigits(v?: string | null) {
  return (v ?? "").replace(/\D+/g, "");
}
function normalizeString(v?: string | null) {
  const s = (v ?? "").trim();
  return s.length ? s : null;
}
function normalizeUF(v?: string | null) {
  const s = normalizeString(v);
  return s ? s.toUpperCase().slice(0, 2) : null;
}
function normalizeTipopessoa(v?: string | null) {
  const s = normalizeString(v);
  if (!s) return null;
  const up = s.toUpperCase();
  return up === "FISICA" || up === "JURIDICA" ? up : null;
}
function isValidEmail(v?: string | null) {
  const s = normalizeString(v);
  if (!s) return true;
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(s);
}

/* ============================
   GET /api/clientes  (listar)
   ============================ */
export async function GET(req: Request) {
  try {
    await requireClientesAccess();
    const { searchParams } = new URL(req.url);

    const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
    const limitRaw =
      searchParams.get("limit") ?? searchParams.get("pageSize") ?? "20";
    const limit = Math.min(Math.max(Number(limitRaw), 1), 100);

    const q = (
      searchParams.get("search") ??
      searchParams.get("q") ??
      ""
    ).trim();

    const statusParam = (searchParams.get("status") ?? "TODOS").toUpperCase();
    const statusFilter = STATUS_SET.has(statusParam as Status)
      ? (statusParam as Status)
      : null;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseAdmin
      .from("cliente")
      .select(
        `
        id, tipopessoa, cpfcnpj, nomerazaosocial, email, telefone, endereco,
        cidade, estado, bairro, cep, inscricaoestadual, inscricaomunicipal, codigomunicipio,
        createdat, updatedat,endereconumero, enderecocomplemento, status, veiculos: veiculo (${VEICULO_FIELDS})
        `,
        { count: "exact" }
      )
      .order("id", { ascending: false })
      .range(from, to);

    if (q) {
      query = query.or(
        `nomerazaosocial.ilike.%${q}%,cpfcnpj.ilike.%${q}%,email.ilike.%${q}%,telefone.ilike.%${q}%`
      );
    }

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const items = data ?? [];
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
      filters: { search: q, status: statusFilter ?? "TODOS" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Erro ao listar clientes" },
      { status: 500 }
    );
  }
}

/* ============================
   POST /api/clientes  (criar)
   ============================ */
// src/app/api/clientes/route.ts (apenas o POST, o resto do arquivo fica como está)
export async function POST(req: Request) {
  try {
    await requireClientesCreate();
    const body = (await req.json()) as any;

    // Suporta { newCustomer: {...} } ou {...} direto
    const json =
      body?.newCustomer && typeof body.newCustomer === "object"
        ? body.newCustomer
        : body;

    if (!json || typeof json !== "object") {
      return NextResponse.json(
        { error: "Corpo da requisição inválido." },
        { status: 400 }
      );
    }

    const tipopessoa = normalizeTipopessoa(String(json.tipopessoa));
    if (!tipopessoa) {
      return NextResponse.json(
        { error: "Valor de 'tipopessoa' inválido. Use 'FISICA' ou 'JURIDICA'." },
        { status: 400 }
      );
    }

    const required = [
      "tipopessoa",
      "cpfcnpj",
      "nomerazaosocial",
      ...(tipopessoa === "JURIDICA" ? ["telefone", "cidade", "estado"] : []),
    ];
    const missing = required.filter(
      (k) => !json[k] || String(json[k]).trim() === ""
    );
    if (missing.length) {
      return NextResponse.json(
        { error: `Campos obrigatórios ausentes: ${missing.join(", ")}.` },
        { status: 400 }
      );
    }

    const cpfcnpj = onlyDigits(String(json.cpfcnpj));
    if (!cpfcnpj) {
      return NextResponse.json({ error: "cpfcnpj inválido." }, { status: 400 });
    }

    if (!isValidEmail(json.email ?? null)) {
      return NextResponse.json({ error: "Email inválido." }, { status: 400 });
    }

    const payload = {
      tipopessoa,
      cpfcnpj,
      nomerazaosocial: String(json.nomerazaosocial).trim(),
      email: normalizeString(json.email ?? null),
      telefone: normalizeString(json.telefone ?? null),
      endereco: normalizeString(json.endereco ?? null),
      cidade: normalizeString(json.cidade ?? null),
      estado: normalizeUF(json.estado ?? null),
      cep: onlyDigits(json.cep ?? null) || null,
      inscricaoestadual: normalizeString(json.inscricaoestadual ?? null),
      inscricaomunicipal: normalizeString(json.inscricaomunicipal ?? null),
      codigomunicipio: normalizeString(json.codigomunicipio ?? null),
      status: (normalizeString(json.status ?? null) as Status | null) ?? null,
    };

    const { data, error } = await supabaseAdmin
      .from("cliente")
      .insert(payload)
      .select(
         `
        ${CLIENTE_FIELDS},
        veiculos:veiculo ( ${VEICULO_FIELDS} )
        `
        )
      .single();

    if (error) {
      // Trata violações de unicidade (cpfcnpj/email/telefone/nomerazaosocial)
      if ((error as any).code === "23505") {
        // Tenta extrair o nome da constraint da mensagem/detalhes
        const raw = `${(error as any).message ?? ""} ${
          (error as any).details ?? ""
        }`;
        const constraint =
          // padrão comum: Duplicate key value violates unique constraint "cliente_email_key"
          raw.match(/unique constraint "([^"]+)"/i)?.[1] ||
          // fallback: ... violates unique constraint cliente_email_key
          raw.match(/unique constraint ([^\s"]+)/i)?.[1] ||
          // outro padrão comum vindo do PostgREST
          raw.match(/cliente_[a-zA-Z_]+_key/)?.[0] ||
          "";

        // Mapeamento nome-da-constraint -> campo legível
        let field:
          | "cpfcnpj"
          | "email"
          | "telefone"
          | "nomerazaosocial"
          | "desconhecido" = "desconhecido";
        if (constraint.includes("cpfcnpj")) field = "cpfcnpj";
        else if (constraint.includes("email")) field = "email";
        else if (constraint.includes("telefone")) field = "telefone";
        else if (
          constraint.includes("nomerazaosocial") ||
          constraint.includes("nome")
        )
          field = "nomerazaosocial";

        const fieldLabel = {
          cpfcnpj: "CPF/CNPJ",
          email: "E-mail",
          telefone: "Telefone",
          nomerazaosocial: "Nome/Razão Social",
          desconhecido: "Campo único",
        }[field];

        return NextResponse.json(
          {
            error: `${fieldLabel} já cadastrado para outro cliente.`,
            field, // útil pro front marcar o input com erro
            constraint, // útil para debug/observabilidade
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: (error as any).message ?? "Erro ao salvar cliente." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: "Cliente criado com sucesso.", id: data.id, data },
      { status: 201 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Erro ao salvar cliente." },
      { status: 500 }
    );
  }
}
