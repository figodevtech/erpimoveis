export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { messageEditSchema, messageIdSchema } from "@/lib/chat/contracts";
import { editMessage } from "../../_lib/repository";
import { chatErrorResponse, chatJson, requireActiveChatUser } from "../../_lib/route-utils";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Edicao de mensagem de texto. Autoria, tipo e prazo sao decididos no SQL: a
 * interface apenas esconde o que o usuario nao poderia executar.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { userId } = await requireActiveChatUser();
    const messageId = messageIdSchema.parse((await params).id);
    const input = messageEditSchema.parse(await request.json().catch(() => null));
    return chatJson(await editMessage(userId, messageId, input.content));
  } catch (error) {
    return chatErrorResponse("PATCH /api/chat/messages/:id", error);
  }
}
