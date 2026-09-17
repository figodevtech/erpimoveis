import { NextResponse } from "next/server";

import { requireSpedManage } from "@/app/api/_authz/perms";
import { configureSpedFiscalItem } from "@/services/fiscal/sped";

import { jsonBody, requireSpedActor, spedErrorResponse } from "../../../_lib/http";

export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSpedManage();
    const actorId = await requireSpedActor();
    const body = await jsonBody(request);
    const { id } = await context.params;
    const data = await configureSpedFiscalItem({
      competenceId: id,
      itemSnapshotId: String(body.itemSnapshotId ?? ""),
      canonicalCode: body.canonicalCode,
      itemType: body.itemType,
      creditTreatment: body.creditTreatment,
      evidence: body.evidence,
      actorId,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return spedErrorResponse(error);
  }
}
