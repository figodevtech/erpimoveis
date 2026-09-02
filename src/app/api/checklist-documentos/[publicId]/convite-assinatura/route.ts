export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireOSAccess, requireOSEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { ChecklistDocumentoError } from "@/lib/ordens/checklist-documentos-server";
import { checklistRequestAudit } from "@/lib/ordens/checklist-request";
import {
  createChecklistSigningInvitation,
  getChecklistSigningInvitation,
  revokeChecklistSigningInvitation,
} from "@/lib/ordens/checklist-signing-server";

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

function errorResponse(error: unknown, fallback: string) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    {
      status: error instanceof ChecklistDocumentoError
        ? error.statusCode
        : Number((error as { statusCode?: number } | null)?.statusCode) || 500,
      headers: HEADERS,
    },
  );
}

export async function GET(request: Request, context: { params: Promise<{ publicId: string }> }) {
  try {
    await requireOSAccess();
    const { publicId } = await context.params;
    const convite = await getChecklistSigningInvitation(publicId, new URL(request.url).origin);
    return NextResponse.json({ convite }, { headers: HEADERS });
  } catch (error) {
    return errorResponse(error, "Não foi possível consultar o convite de assinatura.");
  }
}

export async function POST(request: Request, context: { params: Promise<{ publicId: string }> }) {
  try {
    await requireOSEdit();
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401, headers: HEADERS });
    const { publicId } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const convite = await createChecklistSigningInvitation({
      documentPublicId: publicId,
      cpf: body?.cpf,
      password: body?.senha,
      passwordConfirmation: body?.confirmacaoSenha,
      durationHours: body?.validadeHoras,
      userId,
      audit: checklistRequestAudit(request),
      requestOrigin: new URL(request.url).origin,
    });
    return NextResponse.json({ convite }, { status: 201, headers: HEADERS });
  } catch (error) {
    return errorResponse(error, "Não foi possível criar o convite de assinatura.");
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ publicId: string }> }) {
  try {
    await requireOSEdit();
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401, headers: HEADERS });
    const { publicId } = await context.params;
    const revoked = await revokeChecklistSigningInvitation({
      documentPublicId: publicId,
      userId,
      audit: checklistRequestAudit(request),
    });
    return NextResponse.json({ revoked }, { headers: HEADERS });
  } catch (error) {
    return errorResponse(error, "Não foi possível revogar o convite de assinatura.");
  }
}
