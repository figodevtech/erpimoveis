export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { messageIdSchema } from "@/lib/chat/contracts";
import { deleteMessageForEveryone } from "../../../_lib/repository";
import { chatErrorResponse, chatJson, requireActiveChatUser } from "../../../_lib/route-utils";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Exclusao logica para os dois participantes. Somente o autor, dentro do prazo.
 * O audio associado sai do Storage no mesmo fluxo.
 */
export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { userId } = await requireActiveChatUser();
    const messageId = messageIdSchema.parse((await params).id);
    return chatJson(await deleteMessageForEveryone(userId, messageId));
  } catch (error) {
    return chatErrorResponse("DELETE /api/chat/messages/:id/for-everyone", error);
  }
}
