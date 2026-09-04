import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { requireOSEdit, requireOSEventosFinanceiros } from "@/app/api/_authz/perms";
import {
  analisarExclusaoDoEvento,
  editarEventoDaOs,
  excluirEventoDaOs,
  idValido,
  responder,
  responderFalha,
} from "../_lib/servico";

type Params = { id: string; eventoId: string };

async function idsDosParametros(params: Promise<Params>) {
  const { id, eventoId } = await params;
  const osId = idValido(id);
  const eventId = idValido(eventoId);
  return osId && eventId ? { osId, eventId } : null;
}

const ID_INVALIDO = { ok: false as const, error: "Identificador inválido.", status: 400 };

export async function GET(_: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireOSEdit();
    await requireOSEventosFinanceiros();
    const ids = await idsDosParametros(params);
    if (!ids) return responder(ID_INVALIDO);
    return responder(await analisarExclusaoDoEvento(ids.osId, ids.eventId));
  } catch (error: any) {
    return responderFalha(error, "Erro ao analisar a exclusão do evento financeiro.");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireOSEdit();
    await requireOSEventosFinanceiros();
    const ids = await idsDosParametros(params);
    if (!ids) return responder(ID_INVALIDO);

    const body = await req.json().catch(() => ({}));
    const session = await auth();
    const usuarioId = (session?.user as any)?.id ?? null;
    return responder(
      await excluirEventoDaOs(ids.osId, ids.eventId, String(body?.motivo ?? "").trim(), usuarioId),
    );
  } catch (error: any) {
    return responderFalha(error, "Erro ao excluir evento financeiro.");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireOSEdit();
    await requireOSEventosFinanceiros();
    const ids = await idsDosParametros(params);
    if (!ids) return responder(ID_INVALIDO);

    const session = await auth();
    const usuarioId = (session?.user as any)?.id ?? null;
    return responder(await editarEventoDaOs(ids.osId, ids.eventId, await req.json(), usuarioId));
  } catch (error: any) {
    return responderFalha(error, "Erro ao atualizar snapshot.");
  }
}
