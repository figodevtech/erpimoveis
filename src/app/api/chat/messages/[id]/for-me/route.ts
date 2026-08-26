export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { messageIdSchema } from "@/lib/chat/contracts";
import { deleteMessageForMe } from "../../../_lib/repository";
import { chatErrorResponse, chatJson, requireActiveChatUser } from "../../../_lib/route-utils";

type RouteContext = { params: Promise<{ id: string }> };

/** Oculta a mensagem apenas para quem pediu. O registro principal permanece. */
export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { userId } = await requireActiveChatUser();
    const messageId = messageIdSchema.parse((await params).id);
    return chatJson(await deleteMessageForMe(userId, messageId));
  } catch (error) {
    return chatErrorResponse("DELETE /api/chat/messages/:id/for-me", error);
  }
}
