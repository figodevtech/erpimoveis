import { documentoDoEvento, analisarExclusaoDoDocumento, editarEventoDoDocumento, excluirEventoDoDocumento } from "@/lib/financeiro/eventos-documento";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  requireFinanceiroDelete,
  requireFinanceiroEdit,
  requireFinanceirosAccess,
  requireVendasAccess,
} from "@/app/api/_authz/perms";
import {
  idValido,
  responder,
  responderFalha,
} from "@/lib/financeiro/eventos-financeiros/servico";

type Params = { eventoId: string };

/** Resolve o documento real antes de aplicar suas permissões e regras. */
async function alvoDoEvento(params: Promise<Params>) {
  const eventId = idValido((await params).eventoId);
  if (!eventId) return { ok: false as const, error: "Identificador inválido.", status: 400 };
  const documento = await documentoDoEvento(eventId);
  if (!documento.ok) return documento;
  if (documento.corpo.tipo === "VENDA") {
    await requireVendasAccess();
    await requireFinanceirosAccess();
  }
  return { ok: true as const, corpo: { documento: documento.corpo, eventId } };
}

export async function GET(_: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireFinanceirosAccess();
    const alvo = await alvoDoEvento(params);
    if (!alvo.ok) return responder(alvo);
    return responder(await analisarExclusaoDoDocumento(alvo.corpo.documento, alvo.corpo.eventId));
  } catch (error: any) {
    return responderFalha(error, "Erro ao analisar a exclusão do evento financeiro.");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireFinanceiroEdit();
    const alvo = await alvoDoEvento(params);
    if (!alvo.ok) return responder(alvo);

    const session = await auth();
    const usuarioId = (session?.user as any)?.id ?? null;
    return responder(
      await editarEventoDoDocumento(alvo.corpo.documento, alvo.corpo.eventId, await req.json(), usuarioId),
    );
  } catch (error: any) {
    return responderFalha(error, "Erro ao atualizar o evento financeiro.");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireFinanceiroDelete();
    const alvo = await alvoDoEvento(params);
    if (!alvo.ok) return responder(alvo);

    const body = await req.json().catch(() => ({}));
    const session = await auth();
    const usuarioId = (session?.user as any)?.id ?? null;
    return responder(
      await excluirEventoDoDocumento(
        alvo.corpo.documento,
        alvo.corpo.eventId,
        String(body?.motivo ?? "").trim(),
        usuarioId,
      ),
    );
  } catch (error: any) {
    return responderFalha(error, "Erro ao excluir evento financeiro.");
  }
}
