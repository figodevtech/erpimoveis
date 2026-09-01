export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireOSAccess } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { sha256 } from "@/lib/ordens/checklist-documento-hash";
import {
  ChecklistDocumentoError,
  downloadChecklistAsset,
  loadChecklistDocumento,
  registerChecklistDocumentoEvent,
} from "@/lib/ordens/checklist-documentos-server";
import { checklistRequestAudit } from "@/lib/ordens/checklist-request";

export async function GET(request: Request, context: { params: Promise<{ publicId: string }> }) {
  try {
    await requireOSAccess();
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
    const { publicId } = await context.params;
    const document = await loadChecklistDocumento(publicId, { checkCurrentContent: false });
    if (!document.arquivo) {
      return NextResponse.json({ error: "O PDF oficial ainda não está disponível." }, { status: 409 });
    }
    const bytes = await downloadChecklistAsset(document.arquivo.storagePath);
    if (sha256(bytes) !== document.arquivo.pdfHash) {
      throw new ChecklistDocumentoError("O PDF oficial falhou na verificação de integridade.", 409, "PDF_INVALIDO");
    }
    await registerChecklistDocumentoEvent({
      documentoId: document.id,
      tipo: "PDF_OFICIAL_BAIXADO",
      userId,
      audit: checklistRequestAudit(request),
    });
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `inline; filename="${document.codigo}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("GET PDF checklist", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao baixar o PDF oficial." },
      { status: error instanceof ChecklistDocumentoError ? error.statusCode : Number((error as any)?.statusCode) || 500 },
    );
  }
}
