export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import {
  conversationIdSchema,
  messageCreateSchema,
  messageListQuerySchema,
} from "@/lib/chat/contracts";
import { listMessages, sendMessage } from "../../../_lib/repository";
import { chatErrorResponse, chatJson, requireActiveChatUser } from "../../../_lib/route-utils";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { userId } = await requireActiveChatUser();
    const conversationId = conversationIdSchema.parse((await params).id);
    const query = messageListQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    return chatJson(await listMessages(userId, conversationId, query.cursor, query.limit));
  } catch (error) {
    return chatErrorResponse("GET /api/chat/conversations/:id/messages", error);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { userId } = await requireActiveChatUser();
    const conversationId = conversationIdSchema.parse((await params).id);
    const input = messageCreateSchema.parse(await request.json().catch(() => null));
    const result = await sendMessage(userId, conversationId, input.content, input.clientMessageId);
    return chatJson(result, result.created ? 201 : 200);
  } catch (error) {
    return chatErrorResponse("POST /api/chat/conversations/:id/messages", error);
  }
}

