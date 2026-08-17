export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import {
  requireRadiosAccess,
  requireRadiosDelete,
  requireRadiosEdit,
} from "@/app/api/_authz/perms";
import {
  deleteRadioStation,
  getRadioStation,
  updateRadioStation,
} from "@/lib/radio/repository";
import { getRadioContext, radioErrorResponse, radioJson } from "@/lib/radio/route-utils";
import { radioPatchSchema } from "@/lib/radio/validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    await requireRadiosAccess();
    const context = await getRadioContext();
    const { id } = await params;
    return radioJson({ data: await getRadioStation(id, context) });
  } catch (error) {
    return radioErrorResponse("GET /api/radios/:id", error);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    await requireRadiosEdit();
    const context = await getRadioContext();
    const { id } = await params;
    const patch = radioPatchSchema.parse(await request.json().catch(() => null));
    return radioJson({ data: await updateRadioStation(id, patch, context) });
  } catch (error) {
    return radioErrorResponse("PATCH /api/radios/:id", error);
  }
}

export async function PUT(request: Request, routeContext: RouteContext) {
  return PATCH(request, routeContext);
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    await requireRadiosDelete();
    const context = await getRadioContext();
    const { id } = await params;
    await deleteRadioStation(id, context);
    return radioJson({ success: true });
  } catch (error) {
    return radioErrorResponse("DELETE /api/radios/:id", error);
  }
}
