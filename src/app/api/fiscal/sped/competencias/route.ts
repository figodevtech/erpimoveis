import { NextResponse } from "next/server";

import { requireSpedAccess, requireSpedManage } from "@/app/api/_authz/perms";
import { createSpedCompetence, listSpedCompetences } from "@/services/fiscal/sped";

import { jsonBody, requireSpedActor, spedErrorResponse } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSpedAccess();
    return NextResponse.json({ data: await listSpedCompetences() });
  } catch (error) {
    return spedErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireSpedManage();
    const actorId = await requireSpedActor();
    const body = await jsonBody(request);
    const companyId = body.companyId == null || body.companyId === "" ? null : Number(body.companyId);
    if (companyId !== null && (!Number.isSafeInteger(companyId) || companyId <= 0)) {
      return NextResponse.json({ message: "Empresa inválida." }, { status: 400 });
    }
    const data = await createSpedCompetence({
      companyId,
      competence: String(body.competence ?? ""),
      actorId,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return spedErrorResponse(error);
  }
}
