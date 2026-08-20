// /src/app/api/ordens/realizadores/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { requireOSAccess } from "@/app/api/_authz/perms";

/**
 * GET /api/ordens/realizadores
 *
 * Lista enxuta de usuários que podem ser vinculados como realizadores de um
 * serviço da OS. Existe separada de /api/users porque aquela rota exige a
 * permissão de Usuários — quem opera a oficina precisa atribuir executor sem
 * ter acesso ao cadastro de usuários.
 */
export async function GET() {
  try {
    await requireOSAccess();

    const { data, error } = await supabase
      .from("usuario")
      .select("id, nome, email, comissao_percent, setor:setorid(id,nome), perfil:perfilid(id,nome)")
      .eq("ativo", true)
      .order("nome", { ascending: true });

    if (error) throw error;

    const realizadores = (data ?? []).map((u: any) => ({
      id: String(u.id),
      nome: (u.nome as string | null) ?? null,
      email: (u.email as string | null) ?? null,
      comissao_percent: u.comissao_percent == null ? null : Number(u.comissao_percent),
      setor: u.setor ? { id: Number(u.setor.id), nome: String(u.setor.nome) } : null,
      perfil: u.perfil ? { id: Number(u.perfil.id), nome: String(u.perfil.nome) } : null,
    }));

    return NextResponse.json({ realizadores }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const status = Number(e?.statusCode) || 500;
    console.error("GET /api/ordens/realizadores", e);
    return NextResponse.json({ error: e?.message ?? "Erro ao listar realizadores" }, { status });
  }
}
