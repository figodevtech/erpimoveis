import { NextResponse } from "next/server";

import { requireSpedAccess, requireSpedManage } from "@/app/api/_authz/perms";
import { confirmEntryFiscalDates, listPendingEntryFiscalDates } from "@/services/fiscal/sped";

import { jsonBody, requireSpedActor, spedErrorResponse } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Entradas fiscais confirmadas sem data de escrituração: bloqueiam toda competência até serem confirmadas. */
export async function GET() {
  try {
    await requireSpedAccess();
    return NextResponse.json({ data: await listPendingEntryFiscalDates() });
  } catch (error) {
    return spedErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireSpedManage();
    const actorId = await requireSpedActor();
    const body = await jsonBody(request);
    return NextResponse.json({ data: await confirmEntryFiscalDates({ items: body.entradas, actorId }) });
  } catch (error) {
    return spedErrorResponse(error);
  }
}
