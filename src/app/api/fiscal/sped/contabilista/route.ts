import { NextResponse } from "next/server";

import { requireSpedAccess, requireSpedManage } from "@/app/api/_authz/perms";
import { createSpedAccountant, listSpedAccountants, updateSpedAccountant } from "@/services/fiscal/sped";

import { jsonBody, requireSpedActor, spedErrorResponse } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Contador responsável pela escrituração (registro 0100), com vigência por competência. */
export async function GET(request: Request) {
  try {
    await requireSpedAccess();
    const companyId = new URL(request.url).searchParams.get("companyId");
    return NextResponse.json({ data: await listSpedAccountants(companyId) });
  } catch (error) {
    return spedErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireSpedManage();
    const actorId = await requireSpedActor();
    const { companyId, aPartirDe, ...data } = await jsonBody(request);
    const created = await createSpedAccountant({ companyId, aPartirDe, data, actorId });
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    return spedErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireSpedManage();
    const actorId = await requireSpedActor();
    const { companyId, id, ...data } = await jsonBody(request);
    return NextResponse.json({ data: await updateSpedAccountant({ companyId, id, data, actorId }) });
  } catch (error) {
    return spedErrorResponse(error);
  }
}
