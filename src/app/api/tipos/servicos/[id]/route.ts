// src/app/api/tipos/servicos/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

async function ensureAuth() {
  await requireAuthenticated();
}

function parseId(paramId: string): number | null {
  const n = Number(paramId);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// PUT /api/tipos/servicos/[id] -> editar cadastro completo (inclui 'ativo')
export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureAuth();

    const { id } = await context.params;
    const servicoId = parseId(id);
    if (!servicoId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      codigo,
      descricao,
      precohora,
      ativo,
      gera_comissao,
    } = body ?? {};

    if (!codigo?.trim() || !descricao?.trim()) {
      return NextResponse.json(
        { error: "Insira uma descrição." },
        { status: 400 }
      );
    }

    const preco = Number(precohora);
    if (!Number.isFinite(preco)) {
      return NextResponse.json(
        { error: "Preço/hora inválido." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const payload: Record<string, any> = {
      codigo: codigo.trim(),
      descricao: descricao.trim(),
      precohora: preco,
      updatedat: now,
    };

    if (typeof ativo === "boolean") {
      payload.ativo = ativo;
    }

    if (typeof gera_comissao === "boolean") {
      payload.gera_comissao = gera_comissao;
    }

    const { data, error } = await supabaseAdmin
      .from("servico")
      .update(payload)
      .eq("id", servicoId)
      .select(`
        id,
        codigo,
        descricao,
        precohora,
        codigoservicomunicipal,
        aliquotaiss,
        cnae,
        itemlistaservico,
        tiposervicoid,
        ativo,
        gera_comissao
      `)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Serviço não encontrado." },
        { status: 404 }
      );
    }

    const item = {
      id: data.id as number,
      codigo: data.codigo as string,
      descricao: data.descricao as string,
      precohora: Number(data.precohora ?? 0),
      codigoservicomunicipal: data.codigoservicomunicipal as string,
      aliquotaiss:
        data.aliquotaiss === null || data.aliquotaiss === undefined
          ? null
          : Number(data.aliquotaiss),
      cnae: (data.cnae as string | null) ?? null,
      itemlistaservico: data.itemlistaservico as string,
      tiposervicoid: (data.tiposervicoid as number | null) ?? null,
      ativo: typeof data.ativo === "boolean" ? data.ativo : true,
      gera_comissao: typeof data.gera_comissao === "boolean" ? data.gera_comissao : true,
    };

    return NextResponse.json({ item });
  } catch (e: any) {
    console.error("[/api/tipos/servicos/:id PUT] error:", e);
    const msg = String(e?.message ?? "");
    const status =
      /auth|unauth|não autenticado/i.test(msg)
        ? 401
        : /duplicate|unique|servico_codigo_key/i.test(msg)
        ? 409
        : 500;

    return NextResponse.json(
      { error: e?.message ?? "Erro ao atualizar serviço" },
      { status }
    );
  }
}

// PATCH /api/tipos/servicos/[id] -> alterar somente 'ativo'
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureAuth();

    const { id } = await context.params;
    const servicoId = parseId(id);
    if (!servicoId) {
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
      .from("servico")
      .update({ ativo, updatedat: now })
      .eq("id", servicoId)
      .select(`
        id,
        codigo,
        descricao,
        precohora,
        codigoservicomunicipal,
        aliquotaiss,
        cnae,
        itemlistaservico,
        tiposervicoid,
        ativo,
        gera_comissao
      `)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Serviço não encontrado." },
        { status: 404 }
      );
    }

    const item = {
      id: data.id as number,
      codigo: data.codigo as string,
      descricao: data.descricao as string,
      precohora: Number(data.precohora ?? 0),
      codigoservicomunicipal: data.codigoservicomunicipal as string,
      aliquotaiss:
        data.aliquotaiss === null || data.aliquotaiss === undefined
          ? null
          : Number(data.aliquotaiss),
      cnae: (data.cnae as string | null) ?? null,
      itemlistaservico: data.itemlistaservico as string,
      tiposervicoid: (data.tiposervicoid as number | null) ?? null,
      ativo: typeof data.ativo === "boolean" ? data.ativo : ativo,
      gera_comissao: typeof data.gera_comissao === "boolean" ? data.gera_comissao : true,
    };

    return NextResponse.json({ item });
  } catch (e: any) {
    console.error("[/api/tipos/servicos/:id PATCH] error:", e);
    const status = /auth|unauth|não autenticado/i.test(String(e?.message))
      ? 401
      : 500;

    return NextResponse.json(
      { error: e?.message ?? "Erro ao atualizar status do serviço" },
      { status }
    );
  }
}
