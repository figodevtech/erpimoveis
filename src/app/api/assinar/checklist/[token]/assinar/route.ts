export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { ChecklistDocumentoError } from "@/lib/ordens/checklist-documentos-server";
import { checklistRequestAudit } from "@/lib/ordens/checklist-request";
import {
  checklistSigningVerificationUrl,
  hasChecklistSigningSession,
  resolveChecklistSigningInvitation,
  signChecklistRemotely,
} from "@/lib/ordens/checklist-signing-server";
import { validateChecklistSigningOrigin } from "@/lib/ordens/checklist-signing-security";

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    if (!validateChecklistSigningOrigin(request)) {
      return NextResponse.json({ error: "Origem da solicitação inválida." }, { status: 403, headers: HEADERS });
    }
    const { token } = await context.params;
    const invitation = await resolveChecklistSigningInvitation(token);
    if (!invitation || !hasChecklistSigningSession(request, invitation)) {
      return NextResponse.json({ error: "Sua sessão de assinatura expirou." }, { status: 401, headers: HEADERS });
    }
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const result = await signChecklistRemotely({
      invitation,
      nome: body?.nome,
      qualidade: body?.qualidade,
      qualidadeOutro: body?.qualidadeOutro,
      declaracaoCiente: body?.declaracaoCiente,
      assinaturaDataUrl: body?.assinaturaDataUrl,
      audit: checklistRequestAudit(request),
    });
    return NextResponse.json({
      protocolo: result.document.codigo,
      assinadoEm: result.document.assinatura?.assinadoEm ?? null,
      pdfPendente: result.pdfPendente,
      pdfUrl: result.pdfPendente ? null : `/api/assinar/checklist/${encodeURIComponent(token)}/pdf`,
      verificacaoUrl: checklistSigningVerificationUrl(result.document, new URL(request.url).origin),
    }, { status: result.pdfPendente ? 202 : 200, headers: HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível registrar a assinatura." },
      {
        status: error instanceof ChecklistDocumentoError ? error.statusCode : 500,
        headers: HEADERS,
      },
    );
  }
}
