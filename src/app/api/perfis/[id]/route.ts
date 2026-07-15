export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { PERMS, type Permission } from "@/app/api/_authz/permission-constants";
import { requirePerm } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";

async function exigirAcesso(permissao: Permission = PERMS.PERMISSOES) {
  try {
    await requirePerm(permissao);
    return { ok: true as const };
  } catch (error: any) {
    const msg = String(error?.message ?? "");
    const unauthenticated = /não autenticado|nao autenticado|unauth/i.test(msg);
    return {
      ok: false as const,
      status: (error?.statusCode ?? (unauthenticated ? 401 : 403)) as 401 | 403,
      msg: unauthenticated ? "Não autenticado" : "Sem permissão",
    };
  }
}

type AtualizarPerfilPayload = {
  nome: string;
  descricao?: string | null;
  permissoesIds?: number[];
};

async function getParamId(ctx: any): Promise<string> {
  const p = await (ctx?.params ?? {});
  return p?.id;
}

export async function GET(req: NextRequest, ctx: any) {
  const gate = await exigirAcesso();
  if (!gate.ok) return NextResponse.json({ error: gate.msg }, { status: gate.status });

  const id = await getParamId(ctx);
  const perfilId = Number(id);
  if (!Number.isFinite(perfilId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const [perfilRes, permsRes] = await Promise.all([
    supabaseAdmin
      .from("perfil")
      .select(
        `
          id,
          nome,
          descricao,
          perfilpermissao (
            permissaoid,
            permissao:permissaoid ( id, nome, descricao )
          )
        `
      )
      .eq("id", perfilId)
      .single(),
    supabaseAdmin.from("permissao").select("id, nome, descricao").order("nome", { ascending: true }),
  ]);

  if (perfilRes.error) return NextResponse.json({ error: perfilRes.error.message }, { status: 500 });
  if (permsRes.error) return NextResponse.json({ error: permsRes.error.message }, { status: 500 });

  const data: any = perfilRes.data;

  const perfil = {
    id: data.id,
    nome: data.nome,
    descricao: data.descricao ?? null,
    permissoes: (data.perfilpermissao ?? [])
      .map((pp: any) => pp?.permissao)
      .filter(Boolean)
      .map((perm: any) => ({ id: perm.id, nome: perm.nome, descricao: perm.descricao ?? null })),
  };

  const permissoes = (permsRes.data ?? []).map((perm: any) => ({
    id: perm.id,
    nome: perm.nome,
    descricao: perm.descricao ?? null,
  }));

  return NextResponse.json({ perfil, permissoes, permissoesDisponiveis: permissoes }, { status: 200 });
}

export async function PUT(req: NextRequest, ctx: any) {
  const gate = await exigirAcesso(PERMS.PERMISSOES_EDITAR);
  if (!gate.ok) return NextResponse.json({ error: gate.msg }, { status: gate.status });
  const session = await auth();
  const actorId = ((session?.user as any)?.id as string | undefined) ?? null;

  const id = await getParamId(ctx);
  const perfilId = Number(id);
  if (!Number.isFinite(perfilId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as AtualizarPerfilPayload | null;
  const nome = body?.nome?.trim();
  const descricao = body?.descricao?.trim?.() ? body.descricao.trim() : null;
  const permissoesIds = (body?.permissoesIds ?? []).filter((n) => Number.isFinite(n)) as number[];

  if (!nome) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });

  const { data: perfilAtualizado, error: ePerfil } = await supabaseAdmin
    .from("perfil")
    .update({ nome, descricao, updated_by: actorId, updatedat: new Date().toISOString() })
    .eq("id", perfilId)
    .select("id, nome, descricao")
    .single();

  if (ePerfil) return NextResponse.json({ error: ePerfil.message }, { status: 500 });

  const { error: ePermissoes } = await supabaseAdmin.rpc("atualizar_permissoes_perfil_auditado", {
    p_perfilid: perfilId,
    p_permissoes_ids: permissoesIds,
    p_usuario_id: actorId,
  });
  if (ePermissoes) return NextResponse.json({ error: ePermissoes.message }, { status: 500 });

  return NextResponse.json({ perfil: perfilAtualizado }, { status: 200 });
}
