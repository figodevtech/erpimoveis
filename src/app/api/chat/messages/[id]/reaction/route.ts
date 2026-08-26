export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { messageIdSchema, messageReactionSchema } from "@/lib/chat/contracts";
import { clearMessageReaction, setMessageReaction } from "../../../_lib/repository";
import { chatErrorResponse, chatJson, requireActiveChatUser } from "../../../_lib/route-utils";

type RouteContext = { params: Promise<{ id: string }> };

/** Define ou substitui a unica reacao do usuario na mensagem. */
export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const { userId } = await requireActiveChatUser();
    const messageId = messageIdSchema.parse((await params).id);
    const input = messageReactionSchema.parse(await request.json().catch(() => null));
    return chatJson(await setMessageReaction(userId, messageId, input.reaction));
  } catch (error) {
    return chatErrorResponse("PUT /api/chat/messages/:id/reaction", error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { userId } = await requireActiveChatUser();
    const messageId = messageIdSchema.parse((await params).id);
    return chatJson(await clearMessageReaction(userId, messageId));
  } catch (error) {
    return chatErrorResponse("DELETE /api/chat/messages/:id/reaction", error);
  }
}
