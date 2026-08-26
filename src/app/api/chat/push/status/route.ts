export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { chatPushStatusFor } from "@/lib/chat/web-push";
import { chatErrorResponse, chatJson, requireActiveChatUser } from "../../_lib/route-utils";

/**
 * Informa se o servidor tem VAPID configurado, a chave publica usada pelo
 * navegador e quantos dispositivos ativos o usuario possui. A chave privada
 * nunca sai do servidor.
 */
export async function GET() {
  try {
    const { userId } = await requireActiveChatUser();
    return chatJson(await chatPushStatusFor(userId));
  } catch (error) {
    return chatErrorResponse("GET /api/chat/push/status", error);
  }
}
