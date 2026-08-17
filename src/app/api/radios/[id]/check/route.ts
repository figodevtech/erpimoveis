export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireRadiosEdit } from "@/app/api/_authz/perms";
import { checkRadioStation } from "@/lib/radio/repository";
import { getRadioContext, radioErrorResponse, radioJson } from "@/lib/radio/route-utils";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    await requireRadiosEdit();
    const context = await getRadioContext();
    const { id } = await params;
    const data = await checkRadioStation(id, context);
    return radioJson({
      online: data.result.status === "ONLINE",
      streamStatus: data.station.streamStatus,
      streamUrl: data.station.streamUrl,
      checkedAt: data.result.checkedAt,
      data,
    });
  } catch (error) {
    return radioErrorResponse("POST /api/radios/:id/check", error);
  }
}
