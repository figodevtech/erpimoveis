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
    const result = await radioStreamService.test(input);
    const streamUrl = "streamUrl" in result ? result.streamUrl : result.resolvedUrl;
    return radioJson({
      valid: result.status !== "INVALID",
      online: result.status === "ONLINE",
      type: result.streamType ?? result.playlistFormat,
      streamUrl,
      contentType: result.metadata.contentType,
      codec: result.metadata.codec,
      bitrate: result.metadata.bitrate,
      data: result,
    });
  } catch (error) {
    return radioErrorResponse("POST /api/radios/test", error);
  }
}
