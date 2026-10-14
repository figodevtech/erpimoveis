export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/app/api/_authz/perms";
import { ErroDocumento, PERMISSAO_DO_MODULO, listarParaEmitir, respostaDeErro } from "@/lib/documentos/server";
import { ehModuloDocumento } from "@/lib/documentos/tipos";

/** Os documentos ativos de um módulo, para o dropdown de emissão. */
export async function GET(req: NextRequest) {
  try {
    const modulo = req.nextUrl.searchParams.get("modulo");
    if (!ehModuloDocumento(modulo)) throw new ErroDocumento("Módulo inválido.", 400);
    await requirePerm(PERMISSAO_DO_MODULO[modulo]);
    return NextResponse.json({ items: await listarParaEmitir(modulo) });
  } catch (error) {
    return respostaDeErro(error, "Erro ao listar documentos.");
  }
}
