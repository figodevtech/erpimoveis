export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireRadiosEdit } from "@/app/api/_authz/perms";
import { radioErrorResponse, radioJson } from "@/lib/radio/route-utils";
import { radioStreamService } from "@/lib/radio/stream-service";
import { radioTestSchema } from "@/lib/radio/validation";

export async function POST(request: Request) {
  try {
    await requireRadiosEdit();
    const input = radioTestSchema.parse(await request.json().catch(() => null));
    const url = input.playlistUrl ?? input.url;
    if (!url) return radioJson({ error: "Informe url ou playlistUrl." }, 400);
    const result = await radioStreamService.resolvePlaylist(url);
    return radioJson({
      success: result.status === "ONLINE",
      playlistUrl: result.playlistUrl,
      playlistFormat: result.playlistFormat,
      streams: result.candidates.map((candidate) => ({
        url: candidate.candidateUrl,
        online: candidate.status === "ONLINE",
        status: candidate.status,
      })),
      selectedStream: result.streamUrl,
      data: result,
    });
  } catch (error) {
    return radioErrorResponse("POST /api/radios/resolve", error);
  }
}
