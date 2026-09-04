import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { requireOSAccess, requireOSEdit, requireOSEventosFinanceiros } from "@/app/api/_authz/perms";
import {
  criarEventoDaOs,
  idValido,
  listarEventosDaOs,
  responder,
  responderFalha,
} from "./_lib/servico";

type Params = { id: string };

export async function GET(_: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireOSAccess();
    await requireOSEventosFinanceiros();
    const osId = idValido((await params).id);
    if (!osId) return responder({ ok: false, error: "ID inválido.", status: 400 });
    return responder(await listarEventosDaOs(osId));
  } catch (error: any) {
    return responderFalha(error, "Erro ao carregar eventos financeiros.");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireOSEdit();
    await requireOSEventosFinanceiros();
    const osId = idValido((await params).id);
    if (!osId) return responder({ ok: false, error: "ID inválido.", status: 400 });

    const session = await auth();
    const usuarioId = (session?.user as any)?.id ?? null;
    return responder(await criarEventoDaOs(osId, await req.json(), usuarioId), 201);
  } catch (error: any) {
    return responderFalha(error, "Erro ao criar evento financeiro.");
  }
}
