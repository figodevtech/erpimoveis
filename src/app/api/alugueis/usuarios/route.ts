export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAlugueisAccess } from "@/app/api/_authz/perms";
import { respostaDeErro } from "@/lib/alugueis/server";

/**
 * Usuários ativos que podem receber um aluguel. Separada de /api/users (que
 * exige a permissão de Usuários) e de /api/ordens/realizadores (que exige a de
 * OS): quem opera aluguéis escolhe o destinatário só com a permissão do módulo.
 */
export async function GET() {
  try {
    await requireAlugueisAccess();
    const { data, error } = await supabaseAdmin
      .from("usuario")
      .select("id, nome, email, setor:setorid ( id, nome )")
      .eq("ativo", true)
      .order("nome", { ascending: true });
    if (error) throw error;

    const usuarios = (data ?? []).map((u: any) => ({
      id: String(u.id),
      nome: (u.nome as string | null) ?? null,
      email: (u.email as string | null) ?? null,
      setor: u.setor ? { id: Number(u.setor.id), nome: String(u.setor.nome) } : null,
    }));
    return NextResponse.json({ usuarios }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return respostaDeErro(error, "Erro ao listar usuários.");
  }
}
