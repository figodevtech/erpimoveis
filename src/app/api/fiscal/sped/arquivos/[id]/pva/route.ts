import { NextResponse } from "next/server";

import { requireSpedAccess, requireSpedManage } from "@/app/api/_authz/perms";
import {
  getSpedPvaValidations,
  recordPvaValidation,
  type SpedPvaStatus,
} from "@/services/fiscal/sped";

import { jsonBody, requireSpedActor, spedErrorResponse } from "../../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireSpedAccess();
    const { id } = await context.params;
    return NextResponse.json({ data: await getSpedPvaValidations(id) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return spedErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireSpedManage();
    const actorId = await requireSpedActor();
    const body = await jsonBody(request);
    const { id } = await context.params;

    const validation = await recordPvaValidation({
      arquivoId: id,
      pvaVersao: String(body.pvaVersao ?? ""),
      status: String(body.status ?? "") as SpedPvaStatus,
      observacao: body.observacao ? String(body.observacao) : null,
      relatorioStoragePath: body.relatorioStoragePath ? String(body.relatorioStoragePath) : null,
      relatorioSha256: body.relatorioSha256 ? String(body.relatorioSha256) : null,
      actorId,
    });

    return NextResponse.json({ data: validation }, { status: 201 });
  } catch (error) {
    return spedErrorResponse(error);
  }
}
