import { NextResponse } from "next/server";

import { requireSpedManage } from "@/app/api/_authz/perms";
import { reopenSpedCompetence } from "@/services/fiscal/sped";

import { jsonBody, requireSpedActor, spedErrorResponse } from "../../../_lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSpedManage();
    const actorId = await requireSpedActor();
    const body = await jsonBody(request);
    const { id } = await context.params;
    return NextResponse.json({
      data: await reopenSpedCompetence(id, body.expectedVersion, actorId, body.motivo),
    });
  } catch (error) {
    return spedErrorResponse(error);
  }
}
