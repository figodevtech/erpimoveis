export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { messageIdSchema } from "@/lib/chat/contracts";
import { createVoiceSignedUrl } from "../../_lib/repository";
import { chatErrorResponse, chatJson, requireActiveChatUser } from "../../_lib/route-utils";

type RouteContext = { params: Promise<{ messageId: string }> };

/**
 * Libera o audio por URL assinada de curta duracao. O bucket e privado e o
 * caminho nunca chega ao navegador; participacao, exclusao para todos e
 * exclusao para mim sao conferidas no SQL a cada pedido.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { userId } = await requireActiveChatUser();
    const messageId = messageIdSchema.parse((await params).messageId);
    return chatJson(await createVoiceSignedUrl(userId, messageId));
  } catch (error) {
    return chatErrorResponse("GET /api/chat/audio/:messageId", error);
  }
}
