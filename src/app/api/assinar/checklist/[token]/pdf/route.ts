export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sha256 } from "@/lib/ordens/checklist-documento-hash";
import { checklistRequestAudit } from "@/lib/ordens/checklist-request";
import {
  downloadChecklistAsset,
  registerChecklistDocumentoEvent,
} from "@/lib/ordens/checklist-documentos-server";
import {
  hasChecklistSigningSession,
  resolveChecklistSigningInvitation,
} from "@/lib/ordens/checklist-signing-server";

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const invitation = await resolveChecklistSigningInvitation(token);
    if (!invitation || !hasChecklistSigningSession(request, invitation)) {
      return NextResponse.json({ error: "Sua sessão de assinatura expirou." }, { status: 401, headers: HEADERS });
    }
    if (invitation.status !== "UTILIZADO" || !invitation.document.arquivo) {
      return NextResponse.json({ error: "O PDF oficial ainda não está disponível." }, { status: 409, headers: HEADERS });
    }
    const bytes = await downloadChecklistAsset(invitation.document.arquivo.storagePath);
    if (sha256(bytes) !== invitation.document.arquivo.pdfHash) {
      return NextResponse.json({ error: "O PDF oficial falhou na verificação de integridade." }, { status: 409, headers: HEADERS });
    }
    await registerChecklistDocumentoEvent({
      documentoId: invitation.document.id,
      tipo: "PDF_ASSINATURA_REMOTA_BAIXADO",
      audit: checklistRequestAudit(request),
      metadata: { convitePublicId: invitation.row.public_id, pdfHash: invitation.document.arquivo.pdfHash },
    }).catch(() => undefined);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        ...HEADERS,
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${invitation.document.codigo}.pdf"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Não foi possível baixar o PDF oficial." }, { status: 500, headers: HEADERS });
  }
}
