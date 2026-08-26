export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { listConversations } from "../_lib/repository";
import { chatErrorResponse, chatJson, requireActiveChatUser } from "../_lib/route-utils";

export async function GET() {
  try {
    const { userId } = await requireActiveChatUser();
    return chatJson({ conversations: await listConversations(userId) });
  } catch (error) {
    return chatErrorResponse("GET /api/chat/conversations", error);
  }
}

