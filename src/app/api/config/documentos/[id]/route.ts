export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireConfigAccess, requireConfigDelete, requireConfigEdit } from "@/app/api/_authz/perms";
import {
  DocumentoSchema,
  ErroDocumento,
  atualizarDocumento,
  buscarDocumento,
  excluirDocumento,
  idDaRota,
  respostaDeErro,
  usuarioDaSessao,
} from "@/lib/documentos/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    await requireConfigAccess();
    const item = await buscarDocumento(idDaRota((await context.params).id));
    if (!item) throw new ErroDocumento("Documento não encontrado.", 404);
    return NextResponse.json({ item });
  } catch (error) {
    return respostaDeErro(error, "Erro ao carregar documento.");
  }
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    await requireConfigEdit();
    const usuario = await usuarioDaSessao();
    const id = idDaRota((await context.params).id);
    const entrada = DocumentoSchema.parse(await req.json().catch(() => ({})));
    const item = await atualizarDocumento(id, entrada, usuario);
    return NextResponse.json({ item });
  } catch (error) {
    return respostaDeErro(error, "Erro ao salvar documento.");
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    await requireConfigDelete();
    const usuario = await usuarioDaSessao();
    await excluirDocumento(idDaRota((await context.params).id), usuario);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return respostaDeErro(error, "Erro ao excluir documento.");
  }
}
