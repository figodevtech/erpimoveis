export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { requireFinanceiroEdit } from "@/app/api/_authz/perms";
import {
  idValido,
  ordemDoEvento,
  responder,
  responderFalha,
  sincronizarUltimoCustoDoEvento,
} from "@/lib/financeiro/eventos-financeiros/servico";

type Params = { eventoId: string };

export async function POST(_: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireFinanceiroEdit();
    const eventId = idValido((await params).eventoId);
    if (!eventId) return responder({ ok: false, error: "Identificador inválido.", status: 400 });
    const ordem = await ordemDoEvento(eventId);
    if (!ordem.ok) return responder(ordem);
    return responder(await sincronizarUltimoCustoDoEvento(ordem.corpo.osId, eventId));
  } catch (error: any) {
    return responderFalha(error, "Erro ao sincronizar último custo.");
  }
}
