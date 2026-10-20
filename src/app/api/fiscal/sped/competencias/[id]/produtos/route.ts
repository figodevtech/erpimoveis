import { NextResponse } from "next/server";

import { requireSpedManage } from "@/app/api/_authz/perms";
import { classifySpedProduct } from "@/services/fiscal/sped";

import { jsonBody, requireSpedActor, spedErrorResponse } from "../../../_lib/http";

export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSpedManage();
    const actorId = await requireSpedActor();
    const body = await jsonBody(request);
    const { id } = await context.params;
    const data = await classifySpedProduct({
      competenceId: id,
      productId: body.productId,
      use: body.use,
      actorId,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return spedErrorResponse(error);
  }
}
