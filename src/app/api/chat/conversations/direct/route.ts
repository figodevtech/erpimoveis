export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { directConversationSchema } from "@/lib/chat/contracts";
import { getOrCreateDirectConversation } from "../../_lib/repository";
import { chatErrorResponse, chatJson, requireActiveChatUser } from "../../_lib/route-utils";

export async function POST(request: Request) {
  try {
    const { userId } = await requireActiveChatUser();
    const input = directConversationSchema.parse(await request.json().catch(() => null));
    const result = await getOrCreateDirectConversation(userId, input.recipientId);
    return chatJson(result, result.created ? 201 : 200);
  } catch (error) {
    return chatErrorResponse("POST /api/chat/conversations/direct", error);
  }
}

