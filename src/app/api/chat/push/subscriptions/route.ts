export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@/lib/chat/contracts";
import { revokeChatPushSubscription, saveChatPushSubscription } from "@/lib/chat/web-push";
import { chatErrorResponse, chatJson, requireActiveChatUser } from "../../_lib/route-utils";

/**
 * Registra a subscription do dispositivo atual. Um mesmo usuario pode ter
 * varias; o endpoint identifica o dispositivo e nunca duplica.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireActiveChatUser();
    const input = pushSubscriptionSchema.parse(await request.json().catch(() => null));
    const status = await saveChatPushSubscription(
      userId,
      input,
      request.headers.get("user-agent"),
    );
    return chatJson(status, 201);
  } catch (error) {
    return chatErrorResponse("POST /api/chat/push/subscriptions", error);
  }
}

/** Remove apenas a subscription do dispositivo informado, nunca as demais. */
export async function DELETE(request: Request) {
  try {
    const { userId } = await requireActiveChatUser();
    const input = pushUnsubscribeSchema.parse(await request.json().catch(() => null));
    return chatJson(await revokeChatPushSubscription(userId, input.endpoint));
  } catch (error) {
    return chatErrorResponse("DELETE /api/chat/push/subscriptions", error);
  }
}
