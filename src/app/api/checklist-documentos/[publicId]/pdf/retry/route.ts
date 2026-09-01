export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireOSEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
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
    const document = await ensureChecklistOfficialPdf({ publicId, userId, audit: checklistRequestAudit(request) });
    return NextResponse.json({ document });
  } catch (error) {
    console.error("POST retry PDF checklist", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao gerar novamente o PDF oficial." },
      { status: error instanceof ChecklistDocumentoError ? error.statusCode : Number((error as any)?.statusCode) || 500 },
    );
  }
}
