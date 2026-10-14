export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { PERMS, requireConfigAccess, requirePerm } from "@/app/api/_authz/perms";
import {
  DocumentoSchema,
  criarDocumento,
  listarDocumentos,
  respostaDeErro,
  usuarioDaSessao,
} from "@/lib/documentos/server";
import { ehModuloDocumento } from "@/lib/documentos/tipos";

export async function GET(req: NextRequest) {
  try {
    await requireConfigAccess();
    const modulo = req.nextUrl.searchParams.get("modulo");
    const items = await listarDocumentos(ehModuloDocumento(modulo) ? modulo : null);
    return NextResponse.json({ items });
  } catch (error) {
    return respostaDeErro(error, "Erro ao listar documentos.");
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePerm(PERMS.CONFIG_CRIAR);
    const usuario = await usuarioDaSessao();
    const entrada = DocumentoSchema.parse(await req.json().catch(() => ({})));
    const item = await criarDocumento(entrada, usuario);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return respostaDeErro(error, "Erro ao criar documento.");
  }
}
