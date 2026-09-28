export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";

import { getCurrentUserAccess, requireAcompanhamentoAccess } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function base64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signRealtimeToken(userId: string) {
  const secret = process.env.SUPABASE_CHAT_JWT_SECRET?.trim();
  if (!secret) throw new Error("CENTRAL_REALTIME_NOT_CONFIGURED");
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
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

    // A mesma leitura atende o `ativo` e a permissao logo abaixo.
    const access = await getCurrentUserAccess();
    if (!access || !access.ativo) {
      return NextResponse.json({ error: "INACTIVE_USER" }, { status: 403 });
    }
    await requireAcompanhamentoAccess();

    const tenantResult = await supabaseAdmin.from("empresa").select("id").order("id", { ascending: true }).limit(1).single();
    if (tenantResult.error || !tenantResult.data) throw tenantResult.error ?? new Error("TENANT_NOT_FOUND");

    const tenantId = Number(tenantResult.data.id);
    const existingToken = session.user.supabaseAccessToken;
    const existingExpiresAt = session.user.supabaseAccessTokenExpiresAt;
    const credentials = existingToken && existingExpiresAt && existingExpiresAt > Date.now() + 30_000
      ? { token: existingToken, expiresAt: new Date(existingExpiresAt).toISOString() }
      : signRealtimeToken(userId);

    return NextResponse.json(
      { ...credentials, tenantId, topic: `operational:tenant:${tenantId}` },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "CENTRAL_REALTIME_ERROR";
    const status = message === "CENTRAL_REALTIME_NOT_CONFIGURED" ? 503 : /permiss/i.test(message) ? 403 : 500;
    if (status >= 500 && status !== 503) console.error("[central-operacional] realtime token:", error);
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
