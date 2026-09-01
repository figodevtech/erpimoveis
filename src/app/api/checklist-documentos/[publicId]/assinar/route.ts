export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireOSEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { signChecklistDocumento } from "@/lib/ordens/checklist-documento-assinatura-server";
import { ensureChecklistOfficialPdf } from "@/lib/ordens/checklist-documento-pdf";
import { ChecklistDocumentoError } from "@/lib/ordens/checklist-documentos-server";
import { checklistRequestAudit } from "@/lib/ordens/checklist-request";

export async function POST(request: Request, context: { params: Promise<{ publicId: string }> }) {
  try {
    await requireOSEdit();
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const { publicId } = await context.params;
    const body = await request.json().catch(() => null) as any;
    const audit = checklistRequestAudit(request);
    const signed = await signChecklistDocumento({
      publicId,
      userId,
      nome: body?.nome,
      documento: body?.documento,
      qualidade: body?.qualidade,
      qualidadeOutro: body?.qualidadeOutro,
      assinaturaDataUrl: body?.assinaturaDataUrl,
      declaracaoCiente: body?.declaracaoCiente,
      audit,
    });

    try {
      const document = await ensureChecklistOfficialPdf({ publicId, userId, audit });
      return NextResponse.json({ document, pdfPendente: false });
    } catch (pdfError) {
      console.error("Assinatura preservada; PDF oficial pendente", pdfError);
      return NextResponse.json({
        document: signed,
        pdfPendente: true,
        warning: "A assinatura foi preservada, mas o PDF oficial ainda não foi gerado. Use a opção de tentar novamente.",
      }, { status: 202 });
    }
  } catch (error) {
    console.error("POST /api/checklist-documentos/[publicId]/assinar", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao registrar a assinatura." },
      { status: error instanceof ChecklistDocumentoError ? error.statusCode : Number((error as any)?.statusCode) || 500 },
    );
  }
}
