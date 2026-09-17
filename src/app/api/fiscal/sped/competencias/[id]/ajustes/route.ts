import { NextResponse } from "next/server";

import { requireSpedManage } from "@/app/api/_authz/perms";
import {
  createSpedAssessmentAdjustment,
  deactivateSpedAssessmentAdjustment,
} from "@/services/fiscal/sped";

import { jsonBody, requireSpedActor, spedErrorResponse } from "../../../_lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSpedManage();
    const actorId = await requireSpedActor();
    const body = await jsonBody(request);
    const { id } = await context.params;
    const data = await createSpedAssessmentAdjustment({
      competenceId: id,
      destination: body.destination,
      nature: body.nature,
      code: body.code,
      uf: body.uf,
      value: body.value,
      description: body.description,
      evidence: body.evidence,
      documentNumber: body.documentNumber,
      reference: body.reference,
      actorId,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return spedErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSpedManage();
    const actorId = await requireSpedActor();
    const body = await jsonBody(request);
    const { id } = await context.params;
    const data = await deactivateSpedAssessmentAdjustment({
      competenceId: id,
      adjustmentId: String(body.adjustmentId ?? ""),
      actorId,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return spedErrorResponse(error);
  }
}
