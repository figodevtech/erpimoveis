export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  requireFinanceiroDelete,
  requireFinanceiroEdit,
  requireFinanceirosAccess,
} from "@/app/api/_authz/perms";
import {
  analisarExclusaoDoEvento,
  editarEventoDaOs,
  excluirEventoDaOs,
  idValido,
  ordemDoEvento,
  responder,
  responderFalha,
} from "@/app/api/ordens/[id]/eventos-financeiros/_lib/servico";

type Params = { eventoId: string };

/**
 * O mesmo evento da OS, endereçado pelo financeiro.
 *
 * A regra é a de `_lib/servico` — as guardas de status da OS, de competência e
 * de vínculo financeiro valem igual aqui. O que muda é só a permissão: quem
 * lança o pagamento no caixa é o financeiro, e exigir dele `ordens:editar` para
 * corrigir o valor de uma despesa que a recepção digitou errado seria dar acesso
 * à ordem inteira por causa de um campo.
 */
async function osDoEvento(params: Promise<Params>) {
  const eventId = idValido((await params).eventoId);
  if (!eventId) return { ok: false as const, error: "Identificador inválido.", status: 400 };
  const ordem = await ordemDoEvento(eventId);
  if (!ordem.ok) return ordem;
  return { ok: true as const, corpo: { osId: ordem.corpo.osId, eventId } };
}

export async function GET(_: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireFinanceirosAccess();
    const alvo = await osDoEvento(params);
    if (!alvo.ok) return responder(alvo);
    return responder(await analisarExclusaoDoEvento(alvo.corpo.osId, alvo.corpo.eventId));
  } catch (error: any) {
    return responderFalha(error, "Erro ao analisar a exclusão do evento financeiro.");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireFinanceiroEdit();
    const alvo = await osDoEvento(params);
    if (!alvo.ok) return responder(alvo);

    const session = await auth();
    const usuarioId = (session?.user as any)?.id ?? null;
    return responder(
      await editarEventoDaOs(alvo.corpo.osId, alvo.corpo.eventId, await req.json(), usuarioId),
    );
  } catch (error: any) {
    return responderFalha(error, "Erro ao atualizar o evento financeiro.");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireFinanceiroDelete();
    const alvo = await osDoEvento(params);
    if (!alvo.ok) return responder(alvo);

    const body = await req.json().catch(() => ({}));
    const session = await auth();
    const usuarioId = (session?.user as any)?.id ?? null;
    return responder(
      await excluirEventoDaOs(
        alvo.corpo.osId,
        alvo.corpo.eventId,
        String(body?.motivo ?? "").trim(),
        usuarioId,
      ),
    );
  } catch (error: any) {
    return responderFalha(error, "Erro ao excluir evento financeiro.");
  }
}
