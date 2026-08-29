export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { conversationFocusSchema, conversationIdSchema } from "@/lib/chat/contracts";
import { markConversationFocus } from "../../../_lib/repository";
import { chatErrorResponse, chatJson, requireActiveChatUser } from "../../../_lib/route-utils";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Confirmacao curta de que o participante esta com esta conversa aberta, a aba
 * visivel e o Realtime conectado. Enquanto a janela vale, o Web Push da
 * conversa e suprimido; ela expira sozinha se o cliente parar de reafirmar.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { userId } = await requireActiveChatUser();
    const conversationId = conversationIdSchema.parse((await params).id);
    const input = conversationFocusSchema.parse(await request.json().catch(() => null));
    await markConversationFocus(userId, conversationId, input.active);
    return chatJson({ ok: true });
  } catch (error) {
    return chatErrorResponse("POST /api/chat/conversations/:id/focus", error);
  }
}
