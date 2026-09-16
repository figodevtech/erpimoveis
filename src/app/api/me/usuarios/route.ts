export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hasPerm, PERMS } from "@/app/api/_authz/perms";
import { erroInterno, getMeUserId, isNextResponse } from "../_helpers";

/**
 * Usuarios do seletor da Central Pessoal.
 *
 * Nao reaproveita /api/users: aquela rota exige `usuarios:visualizar` e devolve
 * salario e comissoes. Aqui sai so o necessario para escolher um perfil.
 */
export async function GET() {
  const sessao = await getMeUserId();
  if (isNextResponse(sessao)) return sessao;

  try {
    if (!(await hasPerm(PERMS.USUARIOS_VER_PERFIS))) {
      return NextResponse.json(
        { error: "Sem permissao para visualizar outros usuarios." },
        { status: 403 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("usuario")
      .select("id, nome, email")
      .order("nome", { ascending: true });
    if (error) throw error;

    const users = (data ?? []).map((usuario) => ({
      id: String(usuario.id),
      nome: String(usuario.nome ?? ""),
      email: String(usuario.email ?? ""),
    }));

    return NextResponse.json({ users }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return erroInterno("GET /api/me/usuarios", e);
  }
}
