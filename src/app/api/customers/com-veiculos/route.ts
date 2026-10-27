// src/app/api/customers/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { normalizarIndIEDest } from "@/lib/nfe/indIEDest";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { idDeBusca } from "@/lib/busca-numerica";
import { requireClientesAccess, requireClientesCreate } from "@/app/api/_authz/perms";
import {
  isValidCnpj,
  isValidCpf,
  normalizeCnpj,
  normalizeCpf,
} from "@/lib/fiscal-identifiers";

type Status = "ATIVO" | "INATIVO" | "PENDENTE";
const STATUS_SET = new Set<Status>(["ATIVO", "INATIVO", "PENDENTE"]);

const CLIENTE_FIELDS = `
  id, tipopessoa, cpfcnpj, nomerazaosocial, email, telefone, endereco,
  cidade, estado, bairro, cep, inscricaoestadual, inscricaomunicipal, codigomunicipio,
  ind_ie_dest,
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

function removeAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/* ============================
   GET /api/customers/com-veiculos (listar/buscar)
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
        createdat, updatedat, endereconumero, enderecocomplemento, status, codigo_sistema, veiculos: veiculo (${VEICULO_FIELDS})
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

        // Buscar clientes vinculados a veículos que combinem com a busca (ex: placa, modelo, marca)
        let vehicleClientIds: number[] = [];
        try {
          const { data: matchedVeiculos } = await supabaseAdmin
            .from("veiculo")
            .select("clienteid")
            .or(
              `placa.ilike.%${cleanQ}%,placa_formatada.ilike.%${cleanQ}%,modelo.ilike.%${cleanQ}%,marca.ilike.%${cleanQ}%${
                unaccentedQ !== cleanQ ? `,modelo.ilike.%${unaccentedQ}%,marca.ilike.%${unaccentedQ}%` : ""
              }`
            )
            .limit(100);

          vehicleClientIds = Array.from(
            new Set((matchedVeiculos ?? []).map((v) => Number(v.clienteid)).filter(Boolean))
          );
        } catch {
          // ignora falhas secundárias de veículo
        }

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

        if (vehicleClientIds.length > 0) {
          conditions.push(`id.in.(${vehicleClientIds.join(",")})`);
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

    const cpfcnpj = tipopessoa === "JURIDICA"
      ? normalizeCnpj(json.cpfcnpj)
      : normalizeCpf(json.cpfcnpj);
    const documentoValido = tipopessoa === "JURIDICA"
      ? isValidCnpj(cpfcnpj)
      : isValidCpf(cpfcnpj);
    if (!documentoValido) {
      return NextResponse.json({ error: "CPF/CNPJ inválido." }, { status: 400 });
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
      ind_ie_dest: normalizarIndIEDest(json.ind_ie_dest),
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
