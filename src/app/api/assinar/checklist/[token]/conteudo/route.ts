export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import {
  buildChecklistSigningPublicContent,
  checklistSigningVerificationUrl,
  hasChecklistSigningSession,
  resolveChecklistSigningInvitation,
} from "@/lib/ordens/checklist-signing-server";

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const invitation = await resolveChecklistSigningInvitation(token);
    if (!invitation || !hasChecklistSigningSession(request, invitation)) {
      return NextResponse.json({ error: "Acesso não autorizado." }, { status: 401, headers: HEADERS });
    }
    if (invitation.status !== "ATIVO" && invitation.status !== "UTILIZADO") {
      return NextResponse.json({ error: "Este convite não está mais disponível.", status: invitation.status }, { status: 409, headers: HEADERS });
    }
    return NextResponse.json({
      conteudo: buildChecklistSigningPublicContent(invitation),
      status: invitation.status,
      pdfDisponivel: Boolean(invitation.document.arquivo),
      verificacaoUrl: invitation.status === "UTILIZADO"
        ? checklistSigningVerificationUrl(invitation.document, new URL(request.url).origin)
        : null,
    }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar o checklist." }, { status: 500, headers: HEADERS });
  }
}
