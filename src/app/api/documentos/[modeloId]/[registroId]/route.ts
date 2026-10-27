export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/app/api/_authz/perms";
import {
  ErroDocumento,
  PERMISSAO_DO_MODULO,
  buscarDocumento,
  idDaRota,
  preencherDocumento,
  respostaDeErro,
} from "@/lib/documentos/server";

type RouteContext = { params: Promise<{ modeloId: string; registroId: string }> };

/**
 * O documento já preenchido, para a impressão rápida do menu de emissão:
 * o mesmo HTML que a aba `/print/documento` mostraria.
 */
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { modeloId, registroId } = await context.params;
    const modelo = await buscarDocumento(idDaRota(modeloId));
    if (!modelo) throw new ErroDocumento("Este documento foi excluído.", 404);
    // O middleware só garante que a pessoa vê algum dos módulos; aqui vale o
    // módulo do modelo.
    await requirePerm(PERMISSAO_DO_MODULO[modelo.modulo]);
    if (!modelo.ativo) throw new ErroDocumento(`O documento "${modelo.nome}" está desativado.`, 409);

    const html = await preencherDocumento(modelo, idDaRota(registroId));
    if (html === null) throw new ErroDocumento("Registro não encontrado.", 404);
    return NextResponse.json({ titulo: `${modelo.nome} #${registroId}`, html });
  } catch (error) {
    return respostaDeErro(error, "Erro ao preparar o documento.");
  }
}
