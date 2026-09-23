export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireFinanceiroEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { exigirAcessoATransacao } from "../../_lib/autoria";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Params) {
  try {
    await requireFinanceiroEdit();
    const session = await auth();
    const { id } = await ctx.params;
    await exigirAcessoATransacao(Number(id));
    if (!/^\d+$/.test(id) || id === "0") {
      return NextResponse.json({ error: "Transação inválida." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : null;

    const { data, error } = await supabaseAdmin.rpc("abonar_transacao_pendente", {
      p_transacao_id: id,
      p_abonado_por: (session?.user as any)?.id ?? null,
      p_motivo: motivo || null,
    });

    if (error) {
      if (error.code === "23505" || error.message.includes("ja foi baixada")) {
        return NextResponse.json({ error: "Esta transação já foi baixada." }, { status: 409 });
      }
      if (error.code === "22023") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === "P0002") {
        return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    const statusCode = Number(error?.statusCode ?? 500);
    const status = statusCode === 401 || statusCode === 403 ? statusCode : 500;
    return NextResponse.json(
      { error: error?.message ?? "Não foi possível abonar a transação." },
      { status },
    );
  }
}
