export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireRadiosAccess, requireRadiosCreate } from "@/app/api/_authz/perms";
import { createRadioStation, listRadioStations } from "@/lib/radio/repository";
import { getRadioContext, radioErrorResponse, radioJson } from "@/lib/radio/route-utils";
import { radioCreateSchema, radioListQuerySchema } from "@/lib/radio/validation";

export async function GET(request: Request) {
  try {
    await requireRadiosAccess();
    const context = await getRadioContext();
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const filters = radioListQuerySchema.parse(params);
    return radioJson(await listRadioStations(context, filters));
  } catch (error) {
    return radioErrorResponse("GET /api/radios", error);
  }
}

export async function POST(request: Request) {
  try {
    await requireRadiosCreate();
    const context = await getRadioContext();
    const input = radioCreateSchema.parse(await request.json().catch(() => null));
    return radioJson({ data: await createRadioStation(input, context) }, 201);
  } catch (error) {
    return radioErrorResponse("POST /api/radios", error);
  }
}
