import { NextResponse } from "next/server";

import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireEstoqueAccess();
    const { id: rawId } = await context.params;
    const saidaId = Number(rawId);
    if (!Number.isInteger(saidaId) || saidaId <= 0) {
      return NextResponse.json({ ok: false, message: "Saída inválida." }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin
      .from("nfe")
      .select("id, modelo, serie, numero, chave_acesso, ambiente, status, dataemissao, dataautorizacao, protocolo, total_nfe, codigo_rejeicao, motivo_rejeicao, createdat")
      .eq("saidaid", saidaId)
      .eq("is_deleted", false)
      .order("createdat", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ ok: true, saidaId, nfes: data ?? [] });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Erro ao consultar as NF-e da saída." },
      { status: error?.statusCode === 403 ? 403 : 500 },
    );
  }
}
