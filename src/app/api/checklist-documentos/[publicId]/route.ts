export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { hasPerm, PERMS, requireOSAccess, requirePerm } from "@/app/api/_authz/perms";
import {
  ChecklistDocumentoError,
  deleteChecklistDocumento,
  loadChecklistDocumento,
} from "@/lib/ordens/checklist-documentos-server";

export async function GET(request: Request, context: { params: Promise<{ publicId: string }> }) {
  try {
    await requireOSAccess();
    const { publicId } = await context.params;
    const document = await loadChecklistDocumento(publicId, { checkCurrentContent: true });
    if (new URL(request.url).searchParams.get("divergencia") === "1") {
      return NextResponse.json({ conteudoAtualDivergente: document.conteudoAtualDivergente });
    }
    return NextResponse.json({ document });
  } catch (error) {
    console.error("GET /api/checklist-documentos/[publicId]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar o checklist." },
      { status: error instanceof ChecklistDocumentoError ? error.statusCode : Number((error as any)?.statusCode) || 500 },
    );
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ publicId: string }> }) {
  try {
    await requireOSAccess();
    await requirePerm(PERMS.ORDENS_EXCLUIR);
    const { publicId } = await context.params;
    // A versao assinada e o comprovante que o cliente reconheceu: apaga-la exige
    // a permissao dedicada, alem da de excluir ordens.
    const permitirAssinado = await hasPerm(PERMS.ORDENS_EXCLUIR_CHECKLIST_ASSINADO);
    const excluido = await deleteChecklistDocumento({ publicId, permitirAssinado });
    return NextResponse.json({ excluido });
  } catch (error) {
    console.error("DELETE /api/checklist-documentos/[publicId]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir a versão do checklist." },
      { status: error instanceof ChecklistDocumentoError ? error.statusCode : Number((error as any)?.statusCode) || 500 },
    );
  }
}
