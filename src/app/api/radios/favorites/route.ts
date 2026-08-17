export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireRadiosAccess } from "@/app/api/_authz/perms";
import { listFavoriteRadioStations } from "@/lib/radio/repository";
import { getRadioContext, radioErrorResponse, radioJson } from "@/lib/radio/route-utils";

export async function GET() {
  try {
    await requireRadiosAccess();
    const context = await getRadioContext();
    return radioJson({ data: await listFavoriteRadioStations(context) });
  } catch (error) {
    return radioErrorResponse("GET /api/radios/favorites", error);
  }
}
