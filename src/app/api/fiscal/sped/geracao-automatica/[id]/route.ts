import { after, NextResponse } from "next/server";

import { requireSpedAccess } from "@/app/api/_authz/perms";
import { executeSpedGeneration, getSpedGeneration } from "@/services/fiscal/sped";

import { spedErrorResponse } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSpedAccess();
    const { id } = await context.params;
    const job = await getSpedGeneration(id);
    // Processamento interrompido (timeout, deploy, queda): o acompanhamento
    // retoma em nome de quem pediu. A concessão impede execução em dobro.
    if (job.interrompida) after(() => executeSpedGeneration(job.id));
    return NextResponse.json({ data: job }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return spedErrorResponse(error);
  }
}
