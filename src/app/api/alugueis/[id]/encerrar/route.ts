export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAlugueisEdit } from "@/app/api/_authz/perms";
import { ErroAluguel, idDaRota, respostaDeErro, usuarioDaSessao } from "@/lib/alugueis/server";

/** Body: { encerradoEm?: ISO, observacao?: string }. Devolve todo o estoque do aluguel. */
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAlugueisEdit();
    const usuario = await usuarioDaSessao();
    const id = idDaRota((await context.params).id);
    const body = await req.json().catch(() => ({}));

    let encerradoEm: string | null = null;
    if (body?.encerradoEm) {
      const data = new Date(String(body.encerradoEm));
      if (Number.isNaN(data.getTime())) throw new ErroAluguel("Data de retorno inválida.", 400);
      if (data.getTime() > Date.now() + 60_000) throw new ErroAluguel("A data de retorno não pode estar no futuro.", 400);
      encerradoEm = data.toISOString();
    }

    const { error } = await supabaseAdmin.rpc("aluguel_encerrar", {
      p_id: id,
      p_encerrado_em: encerradoEm,
      p_observacao: String(body?.observacao ?? "").trim() || null,
      p_usuario: usuario,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return respostaDeErro(error, "Erro ao encerrar aluguel.");
  }
}
