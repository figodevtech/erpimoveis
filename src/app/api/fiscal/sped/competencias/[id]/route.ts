import { NextResponse } from "next/server";

import { requireSpedAccess } from "@/app/api/_authz/perms";
import { getSpedCompetenceDetail } from "@/services/fiscal/sped";

import { spedErrorResponse } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSpedAccess();
    const { id } = await context.params;
    return NextResponse.json({ data: await getSpedCompetenceDetail(id) });
  } catch (error) {
    return spedErrorResponse(error);
  }
}
