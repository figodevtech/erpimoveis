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

type CriarPerfilPayload = {
  nome: string;
  descricao?: string | null;
  permissoesIds?: number[];
};

export async function GET() {
  const gate = await exigirAcesso();
  if (!gate.ok) return NextResponse.json({ error: gate.msg }, { status: gate.status });

  const [perfisRes, permsRes] = await Promise.all([
    supabaseAdmin
      .from("perfil")
      .select(
        `
          id,
          nome,
          descricao,
          createdat,
          updatedat,
          perfilpermissao (
            permissaoid,
            permissao:permissaoid ( id, nome, descricao )
          )
        `
      )
      .order("id", { ascending: true }),

    supabaseAdmin.from("permissao").select("id, nome, descricao").order("nome", { ascending: true }),
  ]);

  if (perfisRes.error) return NextResponse.json({ error: perfisRes.error.message }, { status: 500 });
  if (permsRes.error) return NextResponse.json({ error: permsRes.error.message }, { status: 500 });

  const perfis = (perfisRes.data ?? []).map((p: any) => ({
    id: p.id,
    nome: p.nome,
    descricao: p.descricao ?? null,
    permissoes: (p.perfilpermissao ?? [])
      .map((pp: any) => pp?.permissao)
      .filter(Boolean)
      .map((perm: any) => ({ id: perm.id, nome: perm.nome, descricao: perm.descricao ?? null })),
  }));

  const permissoes = (permsRes.data ?? []).map((perm: any) => ({
    id: perm.id,
    nome: perm.nome,
    descricao: perm.descricao ?? null,
  }));

  return NextResponse.json({ perfis, permissoes, permissoesDisponiveis: permissoes }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const gate = await exigirAcesso(PERMS.PERMISSOES_CRIAR);
  if (!gate.ok) return NextResponse.json({ error: gate.msg }, { status: gate.status });
  const session = await auth();
  const actorId = ((session?.user as any)?.id as string | undefined) ?? null;

  const body = (await req.json().catch(() => null)) as CriarPerfilPayload | null;
  const nome = body?.nome?.trim();
  const descricao = body?.descricao?.trim?.() ? body.descricao.trim() : null;
  const permissoesIds = (body?.permissoesIds ?? []).filter((n) => Number.isFinite(n)) as number[];

  if (!nome) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });

  const { data: perfilCriado, error: ePerfil } = await supabaseAdmin
    .from("perfil")
    .insert({ nome, descricao, created_by: actorId, updated_by: actorId })
    .select("id, nome, descricao")
    .single();

  if (ePerfil) return NextResponse.json({ error: ePerfil.message }, { status: 500 });

  if (permissoesIds.length > 0) {
    const { error: eIns } = await supabaseAdmin.rpc("atualizar_permissoes_perfil_auditado", {
      p_perfilid: perfilCriado.id,
      p_permissoes_ids: permissoesIds,
      p_usuario_id: actorId,
    });
    if (eIns) return NextResponse.json({ error: eIns.message }, { status: 500 });
  }

  return NextResponse.json({ perfil: perfilCriado }, { status: 201 });
}
