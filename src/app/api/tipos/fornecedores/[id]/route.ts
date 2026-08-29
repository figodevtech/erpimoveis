// src/app/api/tipos/fornecedores/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/app/api/_authz/perms";
import {
  hasValidCpfCnpjLength,
  onlyFiscalDigits,
} from "@/lib/nfe/recipientNormalization";
import { parsePostgresIntegerId } from "@/lib/postgres-id";
import { supabaseAdmin } from "@/lib/supabaseAdmin";


async function ensureAuth() {
  await requireAuthenticated();
}

function parseId(paramId: string): number | null {
  return parsePostgresIntegerId(paramId);
}

// PUT /api/tipos/fornecedores/[id]  -> editar cadastro completo
export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureAuth();

    const { id } = await context.params;
    const fornecedorId = parseId(id);
    if (!fornecedorId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      cpfcnpj,
      nomerazaosocial,
      nomefantasia,
      endereco,
      cidade,
      endereconumero,
      bairro,
      codigomunicipio,
      estado,
      cep,
      contato,
      ativo,
    }: {
      cpfcnpj?: string;
      nomerazaosocial?: string;
      nomefantasia?: string | null;
      endereco?: string | null;
      cidade?: string | null;
      endereconumero?: string | null;
      bairro?: string | null;
      codigomunicipio?: string | null;
      estado?: string | null;
      cep?: string | null;
      contato?: string | null;
      ativo?: boolean;
    } = body ?? {};

    const documento = onlyFiscalDigits(cpfcnpj);

    if (!hasValidCpfCnpjLength(documento)) {
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

    const payload: Record<string, any> = {
      cpfcnpj: documento,
      nomerazaosocial: nomerazaosocial.trim(),
      nomefantasia: nomefantasia?.trim() || null,
      endereco: endereco?.trim() || null,
      cidade: cidade?.trim() || null,
      endereconumero: endereconumero?.trim() || null,
      bairro: bairro?.trim() || null,
      codigomunicipio: codigomunicipio?.trim() || null,
      estado: estado?.trim() || null,
      cep: cep?.trim() || null,
      contato: contato?.trim() || null,
      updatedat: now,
    };

    // só atualiza 'ativo' se vier booleano no body
    if (typeof ativo === "boolean") {
      payload.ativo = ativo;
    }

    const { data, error } = await supabaseAdmin
      .from("fornecedor")
      .update(payload)
      .eq("id", fornecedorId)
      .select(`
        id,
        cpfcnpj,
        nomerazaosocial,
        nomefantasia,
        endereco,
        cidade,
        endereconumero,
        bairro,
        codigomunicipio,
        estado,
        cep,
        contato,
        ativo
      `)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Fornecedor não encontrado." },
        { status: 404 }
      );
    }

    const item = {
      id: data.id as number,
      cpfcnpj: data.cpfcnpj as string,
      nomerazaosocial: data.nomerazaosocial as string,
      nomefantasia: (data.nomefantasia as string | null) ?? null,
      endereco: (data.endereco as string | null) ?? null,
      cidade: (data.cidade as string | null) ?? null,
      endereconumero: (data.endereconumero as string | null) ?? null,
      bairro: (data.bairro as string | null) ?? null,
      codigomunicipio: (data.codigomunicipio as string | null) ?? null,
      estado: (data.estado as string | null) ?? null,
      cep: (data.cep as string | null) ?? null,
      contato: (data.contato as string | null) ?? null,
      ativo: typeof data.ativo === "boolean" ? data.ativo : true,
    };

    return NextResponse.json({ item });
  } catch (e: any) {
    console.error("[/api/tipos/fornecedores/:id PUT] error:", e);
    const msg = String(e?.message ?? "");
    const status =
      /auth|unauth|não autenticado/i.test(msg) ? 401 :
        /duplicate|unique|fornecedor_cnpj_key/i.test(msg) ? 409 :
          500;

    return NextResponse.json(
      { error: e?.message ?? "Erro ao atualizar fornecedor" },
      { status }
    );
  }
}
// PATCH /api/tipos/fornecedores/[id]  -> alterar somente 'ativo'
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureAuth();

    const { id } = await context.params;
    const fornecedorId = parseId(id);
    if (!fornecedorId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { ativo } = body as { ativo?: boolean };

    if (typeof ativo !== "boolean") {
      return NextResponse.json(
        { error: "Campo 'ativo' deve ser booleano." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("fornecedor")
      .update({ ativo, updatedat: now })
      .eq("id", fornecedorId)
      .select(`
        id,
        cpfcnpj,
        nomerazaosocial,
        nomefantasia,
        endereco,
        cidade,
        endereconumero,
        bairro,
        codigomunicipio,
        estado,
        cep,
        contato,
        ativo
      `)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Fornecedor não encontrado." },
        { status: 404 }
      );
    }

    const item = {
      id: data.id as number,
      cpfcnpj: data.cpfcnpj as string,
      nomerazaosocial: data.nomerazaosocial as string,
      nomefantasia: (data.nomefantasia as string | null) ?? null,
      endereco: (data.endereco as string | null) ?? null,
      cidade: (data.cidade as string | null) ?? null,
      endereconumero: (data.endereconumero as string | null) ?? null,
      bairro: (data.bairro as string | null) ?? null,
      codigomunicipio: (data.codigomunicipio as string | null) ?? null,
      estado: (data.estado as string | null) ?? null,
      cep: (data.cep as string | null) ?? null,
      contato: (data.contato as string | null) ?? null,
      ativo: typeof data.ativo === "boolean" ? data.ativo : ativo,
    };

    return NextResponse.json({ item });
  } catch (e: any) {
    console.error("[/api/tipos/fornecedores/:id PATCH] error:", e);
    const status = /auth|unauth|não autenticado/i.test(String(e?.message)) ? 401 : 500;
    return NextResponse.json(
      { error: e?.message ?? "Erro ao atualizar status do fornecedor" },
      { status }
    );
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureAuth();

    const { id } = await context.params;
    const searchParams = req.nextUrl.searchParams;
    const by = searchParams.get("by"); // 'cnpj' ou 'id'

    let query = supabaseAdmin
      .from("fornecedor")
      .select(`
        id,
        cpfcnpj,
        nomerazaosocial,
        nomefantasia,
        endereco,
        cidade,
        codigomunicipio,
        bairro,
        estado,
        cep,
        contato,
        endereconumero,
        enderecocomplemento,
        ativo,
        createdat,
        updatedat
      `);

    if (by === "cpfcnpj") {
      const cnpj = id.trim();
      if (!cnpj) {
        return NextResponse.json(
          { error: "CNPJ inválido." },
          { status: 400 }
        );
      }
      query = query.eq("cpfcnpj", cnpj);
    } else {
      // modo padrão = busca por id numérico
      const fornecedorId = parseId(id);
      if (!fornecedorId) {
        return NextResponse.json(
          { error: "ID inválido." },
          { status: 400 }
        );
      }
      query = query.eq("id", fornecedorId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) throw error;

    if (!data) {
      return NextResponse.json(
        { error: "Fornecedor não encontrado." },
        { status: 404 }
      );
    }

    const item = {
      id: data.id as number,
      cpfcnpj: data.cpfcnpj as string,
      nomerazaosocial: data.nomerazaosocial as string,
      nomefantasia: (data.nomefantasia as string | null) ?? null,
      endereco: (data.endereco as string | null) ?? null,
      cidade: (data.cidade as string | null) ?? null,
      codigomunicipio: (data.codigomunicipio as string | null) ?? null,
      bairro: (data.bairro as string | null) ?? null,
      estado: (data.estado as string | null) ?? null,
      cep: (data.cep as string | null) ?? null,
      contato: (data.contato as string | null) ?? null,
      endereconumero: (data.endereconumero as string | null) ?? null,
      enderecocomplemento: (data.enderecocomplemento as string | null) ?? null,
      ativo: typeof data.ativo === "boolean" ? data.ativo : true,
      createdat: data.createdat ?? null,
      updatedat: data.updatedat ?? null,
    };

    return NextResponse.json({ item });
  } catch (e: any) {
    console.error("[/api/tipos/fornecedores/:id GET] error:", e);
    const status = /auth|unauth|não autenticado/i.test(String(e?.message))
      ? 401
      : 500;

    return NextResponse.json(
      { error: e?.message ?? "Erro ao buscar fornecedor" },
      { status }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureAuth();

    const { id } = await context.params;
    const fornecedorId = parseId(id);
    if (!fornecedorId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const { data: fornecedor, error: fornecedorError } = await supabaseAdmin
      .from("fornecedor")
      .select("id, nomerazaosocial")
      .eq("id", fornecedorId)
      .maybeSingle();

    if (fornecedorError) throw fornecedorError;
    if (!fornecedor) {
      return NextResponse.json({ error: "Fornecedor não encontrado." }, { status: 404 });
    }

    const [produtos, entradas, notas] = await Promise.all([
      supabaseAdmin
        .from("fornecedorprodutos")
        .select("id", { count: "exact", head: true })
        .eq("fornecedorid", fornecedorId),
      supabaseAdmin
        .from("entrada")
        .select("id", { count: "exact", head: true })
        .eq("fornecedorid", fornecedorId),
      supabaseAdmin
        .from("nfe")
        .select("id", { count: "exact", head: true })
        .eq("fornecedorid", fornecedorId),
    ]);

    const queryError = produtos.error ?? entradas.error ?? notas.error;
    if (queryError) throw queryError;

    const vinculos = {
      produtos: produtos.count ?? 0,
      entradas: entradas.count ?? 0,
      notasFiscais: notas.count ?? 0,
    };
    const totalVinculos = vinculos.produtos + vinculos.entradas + vinculos.notasFiscais;

    if (totalVinculos > 0) {
      return NextResponse.json(
        {
          error: "Este fornecedor está vinculado a outros registros e não pode ser excluído.",
          vinculos,
        },
        { status: 409 }
      );
    }

    const { error: deleteError } = await supabaseAdmin
      .from("fornecedor")
      .delete()
      .eq("id", fornecedorId);

    if (deleteError) {
      if (deleteError.code === "23503") {
        return NextResponse.json(
          { error: "O fornecedor recebeu um novo vínculo e não pode ser excluído." },
          { status: 409 }
        );
      }
      throw deleteError;
    }

    return NextResponse.json({ success: true, id: fornecedorId });
  } catch (e: any) {
    console.error("[/api/tipos/fornecedores/:id DELETE] error:", e);
    const msg = String(e?.message ?? "");
    const status = /auth|unauth|não autenticado/i.test(msg) ? 401 : 500;
    return NextResponse.json(
      { error: e?.message ?? "Erro ao excluir fornecedor" },
      { status }
    );
  }
}
