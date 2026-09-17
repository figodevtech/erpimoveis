import { NextResponse } from "next/server";

import { requireSpedAccess, requireSpedManage } from "@/app/api/_authz/perms";
import { getSpedConfiguration, updateSpedConfiguration } from "@/services/fiscal/sped";

import { jsonBody, requireSpedActor, spedErrorResponse } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function companyIdFrom(value: unknown) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function GET(request: Request) {
  try {
    await requireSpedAccess();
    const companyId = companyIdFrom(new URL(request.url).searchParams.get("companyId"));
    if (!companyId) return NextResponse.json({ message: "Empresa inválida." }, { status: 400 });
    return NextResponse.json({ data: await getSpedConfiguration(companyId) });
  } catch (error) {
    return spedErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireSpedManage();
    const actorId = await requireSpedActor();
    const body = await jsonBody(request);
    const companyId = companyIdFrom(body.companyId);
    if (!companyId) return NextResponse.json({ message: "Empresa inválida." }, { status: 400 });
    const { companyId: _companyId, ...config } = body;
    void _companyId;
    return NextResponse.json({
      data: await updateSpedConfiguration({ companyId, actorId, patch: config }),
    });
  } catch (error) {
    return spedErrorResponse(error);
  }
}
