export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { chatUserQuerySchema } from "@/lib/chat/contracts";
import { listChatUsers } from "../_lib/repository";
import { chatErrorResponse, chatJson, requireActiveChatUser } from "../_lib/route-utils";

export async function GET(request: Request) {
  try {
    const { userId } = await requireActiveChatUser();
    const query = chatUserQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    return chatJson({ users: await listChatUsers(userId, query.q) });
  } catch (error) {
    return chatErrorResponse("GET /api/chat/users", error);
  }
}

