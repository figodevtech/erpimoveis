import { NextResponse } from "next/server";

import { requireSpedManage } from "@/app/api/_authz/perms";
import { validateSpedCompetence } from "@/services/fiscal/sped";

import { jsonBody, requireSpedActor, spedErrorResponse } from "../../../_lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSpedManage();
    const actorId = await requireSpedActor();
    const body = await jsonBody(request);
    const { id } = await context.params;
    const result = await validateSpedCompetence(id, body.expectedVersion, actorId);
    return NextResponse.json({ data: result.data, validation: result.validation, blocked: result.blocked });
  } catch (error) {
    return spedErrorResponse(error);
  }
}
