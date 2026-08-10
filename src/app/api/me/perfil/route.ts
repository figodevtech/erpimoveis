// src/app/api/me/perfil/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { erroInterno, getMeUserId, isNextResponse, relacaoNomeada, texto } from "../_helpers";

export async function GET(req: Request) {
  const userId = await getMeUserId(req);
  if (isNextResponse(userId)) return userId;

  try {
    const { data, error } = await supabaseAdmin
      .from("usuario")
      .select("id, nome, email, ativo, data_admissao, perfil:perfilid (id, nome), setor:setorid (id, nome)")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }

    const registro = data as Record<string, unknown>;

    return NextResponse.json(
      {
        id: String(registro.id),
        nome: texto(registro.nome),
        email: texto(registro.email),
        ativo: registro.ativo !== false,
        dataAdmissao: texto(registro.data_admissao),
        perfil: relacaoNomeada(registro.perfil),
        setor: relacaoNomeada(registro.setor),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return erroInterno("GET /api/me/perfil", e);
  }
}
