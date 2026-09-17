import { NextResponse } from "next/server";

import { requireSpedManage } from "@/app/api/_authz/perms";
import { isValidCivilDate } from "@/lib/fiscal-date";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { jsonBody, requireSpedActor, spedErrorResponse } from "../../../_lib/http";

export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSpedManage();
    const actorId = await requireSpedActor();
    const body = await jsonBody(request);
    const { id: rawId } = await context.params;
    const entradaId = Number(rawId);
    const civilDate = String(body.dataEntradaFiscal ?? "").trim();
    if (!Number.isSafeInteger(entradaId) || entradaId <= 0) {
      return NextResponse.json({ message: "Entrada inválida." }, { status: 400 });
    }
    if (!isValidCivilDate(civilDate)) {
      return NextResponse.json({ message: "Data fiscal civil inválida." }, { status: 400 });
    }

    const result = await supabaseAdmin
      .from("entrada")
      .update({
        data_entrada_fiscal: civilDate,
        data_entrada_fiscal_confirmada_em: new Date().toISOString(),
        data_entrada_fiscal_confirmada_por: actorId,
      })
      .eq("id", entradaId)
      .eq("fiscal", true)
      .select("id, data_entrada_fiscal, data_entrada_fiscal_confirmada_em, data_entrada_fiscal_confirmada_por")
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return NextResponse.json({ message: "Entrada fiscal não encontrada." }, { status: 404 });
    return NextResponse.json({ data: result.data });
  } catch (error) {
    return spedErrorResponse(error);
  }
}
