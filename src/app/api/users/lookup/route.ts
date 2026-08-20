export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUsuariosAccess } from "@/app/api/_authz/perms";

export async function GET() {
  try {
    await requireUsuariosAccess();

    const [s, p, pf] = await Promise.all([
      supabaseAdmin.from("setor").select("id, nome").eq("ativo", true).order("nome"),
      supabaseAdmin.from("permissao").select("id, nome, descricao").order("nome"),
      supabaseAdmin.from("perfil").select("id, nome").order("nome"),
    ]);

    if (s.error) throw s.error;
    if (p.error) throw p.error;
    if (pf.error) throw pf.error;

    return NextResponse.json({
      setores: s.data ?? [],
      permissoes: p.data ?? [],
      perfis: pf.data ?? [],
    });
  } catch (e: any) {
    console.error("[/api/users/lookup] error:", e);
    const status = /não autenticado|unauth|auth/i.test(String(e?.message)) ? 401 : 500;
    return NextResponse.json({ error: e?.message ?? "Erro ao carregar listas" }, { status });
  }
}
