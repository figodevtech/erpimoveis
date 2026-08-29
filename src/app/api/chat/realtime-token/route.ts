export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createHmac } from "node:crypto";

import { ChatApiError, chatErrorResponse, chatJson, requireActiveChatUser } from "../_lib/route-utils";

function base64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signRealtimeToken(userId: string) {
  const secret = process.env.SUPABASE_CHAT_JWT_SECRET?.trim();
  if (!secret) {
    throw new ChatApiError(
      "CHAT_REALTIME_NOT_CONFIGURED",
      503,
      "O segredo de assinatura do Realtime do chat nao foi configurado.",
    );
  }

  const now = Math.floor(Date.now() / 1_000);
  const expiresAt = now + 10 * 60;
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: expiresAt,
  }));
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return { token: `${header}.${payload}.${signature}`, expiresAt: new Date(expiresAt * 1_000).toISOString() };
}

export async function GET() {
  try {
    const context = await requireActiveChatUser();
    if (
      context.supabaseAccessToken &&
      context.supabaseAccessTokenExpiresAt &&
      context.supabaseAccessTokenExpiresAt > Date.now() + 30_000
    ) {
      return chatJson({
        token: context.supabaseAccessToken,
        expiresAt: new Date(context.supabaseAccessTokenExpiresAt).toISOString(),
      });
    }

    // Sessões criadas antes desta fase não carregam o token Supabase. O segredo
    // opcional mantém essas sessões operacionais durante uma implantação gradual.
    return chatJson(signRealtimeToken(context.userId));
  } catch (error) {
    return chatErrorResponse("GET /api/chat/realtime-token", error);
  }
}
