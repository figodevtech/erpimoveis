export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireOSAccess } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { tipoChecklistValido } from "@/lib/ordens/checklist-documento";
import {
  ChecklistDocumentoError,
  createChecklistDocumento,
  listChecklistDocumentos,
} from "@/lib/ordens/checklist-documentos-server";
import { checklistRequestAudit } from "@/lib/ordens/checklist-request";

function responseError(error: unknown) {
  console.error("/api/checklist-documentos", error);
  const status = error instanceof ChecklistDocumentoError
    ? error.statusCode
    : Number((error as any)?.statusCode) || 500;
  return NextResponse.json({
    error: error instanceof Error ? error.message : "Falha ao processar o documento de checklist.",
    code: error instanceof ChecklistDocumentoError ? error.code : undefined,
  }, { status });
}

export async function GET(request: NextRequest) {
  try {
    await requireOSAccess();
    const ordemServicoId = Number(request.nextUrl.searchParams.get("ordemServicoId"));
    const typeValue = request.nextUrl.searchParams.get("tipo");
    const tipo = tipoChecklistValido(typeValue) ? typeValue : undefined;
    if (!Number.isInteger(ordemServicoId) || ordemServicoId <= 0) {
      return NextResponse.json({ error: "ID da OS inválido." }, { status: 400 });
    }
    if (typeValue && !tipo) {
      return NextResponse.json({ error: "Tipo de checklist inválido." }, { status: 400 });
    }
    const items = await listChecklistDocumentos({ ordemServicoId, tipo });
    return NextResponse.json({ items });
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireOSAccess();
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const body = await request.json().catch(() => null) as any;
    const ordemServicoId = Number(body?.ordemServicoId);
    if (!Number.isInteger(ordemServicoId) || ordemServicoId <= 0) {
      return NextResponse.json({ error: "ID da OS inválido." }, { status: 400 });
    }
    if (!tipoChecklistValido(body?.tipo)) {
      return NextResponse.json({ error: "Tipo de checklist inválido." }, { status: 400 });
    }
    const document = await createChecklistDocumento({
      ordemServicoId,
      tipo: body.tipo,
      userId,
      audit: checklistRequestAudit(request),
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return responseError(error);
  }
}
