export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { conversationIdSchema, markReadSchema } from "@/lib/chat/contracts";
import { markConversationRead } from "../../../_lib/repository";
import { chatErrorResponse, chatJson, requireActiveChatUser } from "../../../_lib/route-utils";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { userId } = await requireActiveChatUser();
    const conversationId = conversationIdSchema.parse((await params).id);
    const input = markReadSchema.parse(await request.json().catch(() => null));
    return chatJson(await markConversationRead(userId, conversationId, input.lastMessageId));
  } catch (error) {
    return chatErrorResponse("POST /api/chat/conversations/:id/read", error);
  }
}

