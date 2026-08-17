export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireRadiosAccess } from "@/app/api/_authz/perms";
import { addRadioFavorite, removeRadioFavorite } from "@/lib/radio/repository";
import { getRadioContext, radioErrorResponse, radioJson } from "@/lib/radio/route-utils";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    await requireRadiosAccess();
    const context = await getRadioContext();
    const { id } = await params;
    await addRadioFavorite(id, context);
    return radioJson({ success: true }, 201);
  } catch (error) {
    return radioErrorResponse("POST /api/radios/:id/favorite", error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    await requireRadiosAccess();
    const context = await getRadioContext();
    const { id } = await params;
    await removeRadioFavorite(id, context);
    return radioJson({ success: true });
  } catch (error) {
    return radioErrorResponse("DELETE /api/radios/:id/favorite", error);
  }
}
