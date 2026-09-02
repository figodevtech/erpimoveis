export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import {
  hasChecklistSigningSession,
  resolveChecklistSigningInvitation,
} from "@/lib/ordens/checklist-signing-server";

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const invitation = await resolveChecklistSigningInvitation(token);
    if (!invitation) {
      return NextResponse.json({ error: "Convite inválido ou indisponível." }, { status: 404, headers: HEADERS });
    }
    return NextResponse.json({
      status: invitation.status,
      expiraEm: invitation.row.expira_em,
      autenticado: hasChecklistSigningSession(request, invitation),
    }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar o convite." }, { status: 500, headers: HEADERS });
  }
}
