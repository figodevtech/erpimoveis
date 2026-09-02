export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { ChecklistDocumentoError } from "@/lib/ordens/checklist-documentos-server";
import {
  hasChecklistSigningSession,
  loadChecklistSigningAsset,
  resolveChecklistSigningInvitation,
} from "@/lib/ordens/checklist-signing-server";

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request, context: { params: Promise<{ token: string; assetKey: string }> }) {
  try {
    const { token, assetKey } = await context.params;
    if (!/^[0-9a-f]{64}$/.test(assetKey)) {
      return NextResponse.json({ error: "Ativo não encontrado." }, { status: 404, headers: HEADERS });
    }
    const invitation = await resolveChecklistSigningInvitation(token);
    if (
      !invitation || !hasChecklistSigningSession(request, invitation) ||
      (invitation.status !== "ATIVO" && invitation.status !== "UTILIZADO")
    ) return NextResponse.json({ error: "Acesso não autorizado." }, { status: 401, headers: HEADERS });
    const asset = await loadChecklistSigningAsset(invitation, assetKey);
    return new NextResponse(new Uint8Array(asset.bytes), { headers: { ...HEADERS, "Content-Type": asset.mimeType } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof ChecklistDocumentoError ? error.message : "Não foi possível carregar o ativo." },
      { status: error instanceof ChecklistDocumentoError ? error.statusCode : 500, headers: HEADERS },
    );
  }
}
