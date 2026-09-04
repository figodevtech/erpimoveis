import { NextRequest } from "next/server";
import { requireOSEdit, requireOSEventosFinanceiros } from "@/app/api/_authz/perms";
import {
  idValido,
  responder,
  responderFalha,
  sincronizarValorDeVendaDoEvento,
} from "../../_lib/servico";

type Params = { id: string; eventoId: string };

export async function POST(_: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireOSEdit();
    await requireOSEventosFinanceiros();
    const { id, eventoId } = await params;
    const osId = idValido(id);
    const eventId = idValido(eventoId);
    if (!osId || !eventId) {
      return responder({ ok: false, error: "Identificador inválido.", status: 400 });
    }
    return responder(await sincronizarValorDeVendaDoEvento(osId, eventId));
  } catch (error: any) {
    return responderFalha(error, "Erro ao sincronizar valor de venda.");
  }
}
