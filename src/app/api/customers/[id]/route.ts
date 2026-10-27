// src/app/api/clientes/[id]/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { normalizarIndIEDest } from "@/lib/nfe/indIEDest";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireClientesAccess, requireClientesDelete, requireClientesEdit } from "@/app/api/_authz/perms";
import { resolveOrdemVehicle } from "@/lib/ordens/vehicle-snapshot";
import { recusaSeClienteDoSistema } from "@/lib/clientes/consumidor-final-server";
import { mapearItemHistorico } from "@/lib/ordens/itens-historicos";
import {
  isValidCnpj,
  isValidCpf,
  normalizeCnpj,
  normalizeCpf,
} from "@/lib/fiscal-identifiers";

type Params = { params: Promise<{ id: string }> };

const CLIENTE_FIELDS = `
  id, tipopessoa, cpfcnpj, nomerazaosocial, email, telefone, endereco,
  cidade, estado, bairro, cep, inscricaoestadual, inscricaomunicipal, codigomunicipio,
  ind_ie_dest,
  createdat, updatedat, endereconumero, enderecocomplemento, status, rank, foto_url,
  saldo_credito
`;

const TELEFONE_FIELDS = `
  id, telefone, contato, observacao
`;

const VEICULO_FIELDS = `
  id, clienteid, placa, placa_formatada, modelo, marca, ano, cor, kmatual, tipo, createdat, updatedat
`;

const ORDEM_FIELDS = `
  id, clienteid, descricao, status, prioridade, alvo_tipo, migracao_referencia, veiculo_snapshot,
  equipamento_nome, equipamento_patrimonio, equipamento_ano, equipamento_horimetro,
  dataentrada, createdat, orcamentototal,
  peca:peca ( id, titulo, descricao, lacre ),
  veiculo:veiculo ( id, placa, modelo, marca ),
  produtos:osproduto (
    quantidade,
    precounitario,
    subtotal,
    produto:produtoid ( id, titulo )
  ),
  servicos:osservico (
    quantidade,
    precounitario,
    subtotal,
    servico:servicoid ( id, descricao )
  ),
  itens_historicos:ositem_historico (
    id, ordemservicoid, linha_origem, tipo, codigo_legado, descricao,
    unidade, quantidade, preco_unitario, subtotal
  )
`

type Status = "ATIVO" | "INATIVO" | "PENDENTE";
const STATUS_SET = new Set<Status>(["ATIVO", "INATIVO", "PENDENTE"]);

const WRITABLE_FIELDS = new Set([
  "tipopessoa",
  "cpfcnpj",
  "nomerazaosocial",
  "email",
  "telefone",
  "endereco",
  "endereconumero",
  "enderecocomplemento",
  "cidade",
  "estado",
  "bairro",
  "cep",
  "inscricaoestadual",
  "inscricaomunicipal",
  "codigomunicipio",
  "ind_ie_dest",
  "status",
  "rank",
]);

function toNullIfEmpty(v: unknown) {
  return typeof v === "string" && v.trim() === "" ? null : v;
}

function isValidEmail(v: unknown) {
  if (v == null) return true;
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s) return true;
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(s);
}

function sanitizePayload(body: any, { strict }: { strict: boolean }) {
  const out: Record<string, any> = {};
  for (const key of Object.keys(body ?? {})) {
    if (!WRITABLE_FIELDS.has(key)) continue;
    out[key] = toNullIfEmpty(body[key]);
  }

  // O CHECK da coluna só aceita 1, 2 ou 9. Qualquer outra coisa vira NULL
  // (não classificado) em vez de estourar erro de constraint no banco.
  if ("ind_ie_dest" in out) {
    out.ind_ie_dest = normalizarIndIEDest(out.ind_ie_dest);
  }

  if (out.status != null) {
    const up = String(out.status).toUpperCase();
    if (!STATUS_SET.has(up as Status)) {
      throw new Error("Status inválido. Use ATIVO, INATIVO ou PENDENTE.");
    }
    out.status = up;
  }

  if ("tipopessoa" in out && out.tipopessoa != null) {
    const tipo = String(out.tipopessoa).toUpperCase();
    if (tipo !== "FISICA" && tipo !== "JURIDICA") {
      throw new Error("Tipo de pessoa inválido. Use FISICA ou JURIDICA.");
    }
    out.tipopessoa = tipo;
  }

  if ("cpfcnpj" in out && out.cpfcnpj != null) {
    const tipo = out.tipopessoa ?? (/^[0-9.\-/\s]{1,14}$/.test(String(out.cpfcnpj))
      && normalizeCpf(out.cpfcnpj).length === 11 ? "FISICA" : "JURIDICA");
    const documento = tipo === "FISICA"
      ? normalizeCpf(out.cpfcnpj)
      : normalizeCnpj(out.cpfcnpj);
    const valido = tipo === "FISICA" ? isValidCpf(documento) : isValidCnpj(documento);
    if (!valido) throw new Error("CPF/CNPJ inválido.");
    out.cpfcnpj = documento;
  }

  if (strict) {
    const required = [
      "tipopessoa",
      "cpfcnpj",
      "nomerazaosocial",
      ...(out.tipopessoa === "JURIDICA" ? ["telefone", "cidade", "estado"] : []),
    ];
    const missing = required.filter((k) => out[k] == null);
    if (missing.length) {
      throw new Error(
        `Campos obrigatórios ausentes no PUT: ${missing.join(", ")}`
      );
    }
  }

  if ("email" in out && !isValidEmail(out.email)) {
    throw new Error("Email inválido.");
  }

  out.updatedat = new Date().toISOString();
  return out;
}

async function parseId(ctx: Params) {
  const { id: idParam } = await ctx.params;
  const id = Number((idParam ?? "").trim());
  if (!id) throw new Error("ID inválido.");
  return id;
}

/* ========================= GET ========================= */

export async function GET(_: Request, ctx: Params) {
  try {
    await requireClientesAccess();
    const id = await parseId(ctx);

    const { data, error } = await supabaseAdmin
      .from("cliente")
      .select(
        `
        ${CLIENTE_FIELDS},
        telefones:cliente_telefone ( ${TELEFONE_FIELDS} ),
        veiculos:veiculo ( ${VEICULO_FIELDS} ),
        ordens: ordemservico ( ${ORDEM_FIELDS} )
        `
      )
      .eq("id", id)
      .single();

    if (error) {
      if ((error as any).code === "PGRST116") {
        return NextResponse.json(
          { error: "Cliente não encontrado." },
          { status: 404 }
        );
      }
      throw error;
    }

    const resposta = {
      ...data,
      // O principal continua em `telefone`; aqui vêm só os contatos extras.
      telefones: [...((data as any).telefones ?? [])].sort((a: any, b: any) => a.id - b.id),
      ordens: (data.ordens ?? []).map((ordem: any) => ({
        ...ordem,
        migracaoReferencia: ordem.migracao_referencia ?? null,
        veiculo: resolveOrdemVehicle(ordem.veiculo, ordem.veiculo_snapshot),
        itensHistoricos: (ordem.itens_historicos ?? []).map(mapearItemHistorico),
      })),
    };

    return NextResponse.json({ data: resposta });
  } catch (e: any) {
    const msg = e?.message ?? "Erro ao buscar cliente.";
    const status = msg.includes("inválido") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/* ========================= PATCH ========================= */

export async function PATCH(req: Request, ctx: Params) {
  try {
    await requireClientesEdit();
    const id = await parseId(ctx);
    const recusa = await recusaSeClienteDoSistema(id);
    if (recusa) return recusa;
    const body = await req.json().catch(() => ({}));
    const payload = sanitizePayload(body, { strict: false });

    if (Object.keys(payload).length === 1 && "updatedat" in payload) {
      return NextResponse.json(
        { error: "Nada para atualizar." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("cliente")
      .update(payload)
      .eq("id", id)
      .select(CLIENTE_FIELDS)
      .single();

    if (error) {
      if ((error as any).code === "23505") {
        return NextResponse.json(
          { error: "CPF/CNPJ já cadastrado." },
          { status: 409 }
        );
      }
      if ((error as any).code === "PGRST116") {
        return NextResponse.json(
          { error: "Cliente não encontrado." },
          { status: 404 }
        );
      }
      throw error;
    }

    return NextResponse.json({ data, id: data.id });
  } catch (e: any) {
    const msg = e?.message ?? "Erro ao atualizar cliente.";
    const status = msg.includes("ID inválido") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/* ========================= PUT ========================= */

export async function PUT(req: Request, ctx: Params) {
  try {
    await requireClientesEdit();
    const id = await parseId(ctx);
    const recusa = await recusaSeClienteDoSistema(id);
    if (recusa) return recusa;
    const body = await req.json().catch(() => ({}));
    const payload = sanitizePayload(body, { strict: true });

    const { data, error } = await supabaseAdmin
      .from("cliente")
      .update(payload)
      .eq("id", id)
      .select(CLIENTE_FIELDS)
      .single();

    if (error) {
      if ((error as any).code === "23505") {
        return NextResponse.json(
          { error: "CPF/CNPJ já cadastrado." },
          { status: 409 }
        );
      }
      if ((error as any).code === "PGRST116") {
        return NextResponse.json(
          { error: "Cliente não encontrado." },
          { status: 404 }
        );
      }
      throw error;
    }

    return NextResponse.json({ data, id: data.id });
  } catch (e: any) {
    const msg = e?.message ?? "Erro ao atualizar cliente.";
    const status =
      msg.includes("inválido") || msg.includes("Campos obrigatórios")
        ? 400
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/* ========================= DELETE =========================
   Se você tiver ON DELETE CASCADE em todas as FKs, pode simplificar
   para deletar apenas o cliente. Abaixo está a versão defensiva,
   apagando em ordem (checklist -> ordemservico -> veiculo -> cliente).
============================================================= */

export async function DELETE(_: Request, ctx: Params) {
  try {
    await requireClientesDelete();
    const { id: idParam } = await ctx.params;
    const id = Number((idParam ?? "").trim());
    if (!id) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }
    const recusa = await recusaSeClienteDoSistema(id);
    if (recusa) return recusa;

    // Com ON DELETE CASCADE, basta deletar o cliente.
    // Usamos .select('id') para saber se encontrou/deletou algo.
    const { data, error } = await supabaseAdmin
      .from("cliente")
      .delete()
      .eq("id", id)
      .select("id");

    if (error) throw error;

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: "Cliente não encontrado." },
        { status: 404 }
      );
    }

    // 204 No Content é o mais semântico para DELETE bem-sucedido
    return new NextResponse(null, { status: 204 });
    // Se preferir payload:
    // return NextResponse.json({ success: true, deletedId: data[0].id }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Erro ao deletar cliente." },
      { status: 500 }
    );
  }
}
