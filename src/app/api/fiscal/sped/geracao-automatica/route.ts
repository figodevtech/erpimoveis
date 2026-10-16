import { after, NextResponse } from "next/server";

import { requireSpedAccess, requireSpedManage } from "@/app/api/_authz/perms";
import {
  executeSpedGeneration,
  getLatestSpedGeneration,
  requestSpedGeneration,
  spedGenerationNeedsRunner,
} from "@/services/fiscal/sped";

import { jsonBody, requireSpedActor, spedErrorResponse } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// O processamento roda depois da resposta (after) e é retomável; o limite só
// precisa cobrir uma execução contínua típica.
export const maxDuration = 300;

function companyIdFrom(value: unknown): number | null {
  if (value == null || value === "") return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : Number.NaN;
}

export async function GET(request: Request) {
  try {
    await requireSpedAccess();
    const params = new URL(request.url).searchParams;
    const companyId = companyIdFrom(params.get("companyId"));
    if (Number.isNaN(companyId)) return NextResponse.json({ message: "Empresa inválida." }, { status: 400 });
    const job = await getLatestSpedGeneration({ competence: String(params.get("competencia") ?? ""), companyId });
    if (job && job.interrompida) after(() => executeSpedGeneration(job.id));
    return NextResponse.json({ data: job }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return spedErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireSpedManage();
    const actorId = await requireSpedActor();
    const body = await jsonBody(request);
    const companyId = companyIdFrom(body.companyId);
    if (Number.isNaN(companyId)) return NextResponse.json({ message: "Empresa inválida." }, { status: 400 });
    const job = await requestSpedGeneration({ competence: String(body.competencia ?? ""), companyId, actorId });
    if (await spedGenerationNeedsRunner(job.id)) after(() => executeSpedGeneration(job.id));
    return NextResponse.json({ data: job }, { status: 202 });
  } catch (error) {
    return spedErrorResponse(error);
  }
}
