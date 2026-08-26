export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getUnreadCount } from "../_lib/repository";
import { chatErrorResponse, chatJson, requireActiveChatUser } from "../_lib/route-utils";

export async function GET() {
  try {
    const { userId } = await requireActiveChatUser();
    return chatJson({ unreadCount: await getUnreadCount(userId) });
  } catch (error) {
    return chatErrorResponse("GET /api/chat/unread-count", error);
  }
}

