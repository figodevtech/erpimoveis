export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCurrentUserAccess, requireAny, PERMS } from "@/app/api/_authz/perms";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401, headers });
    const access = await getCurrentUserAccess();
    if (!access?.ativo) return NextResponse.json({ error: "INACTIVE_USER" }, { status: 403, headers });
    await requireAny([PERMS.ORDENS, PERMS.EXECUCAO_OS, PERMS.ACOMPANHAMENTO, PERMS.FINANCEIRO_ACOMPANHAMENTO]);
    const tenant = await supabaseAdmin.from("empresa").select("id").order("id", { ascending: true }).limit(1).single();
    if (tenant.error || !tenant.data) throw new Error("TENANT_NOT_FOUND");
    const tenantId = Number(tenant.data.id);
    let token = session.user.supabaseAccessToken;
    let expiresAt = session.user.supabaseAccessTokenExpiresAt;
    if (!token || !expiresAt || expiresAt <= Date.now() + 60_000) {
      // Compatibilidade com sessões anteriores ao login via Supabase Auth.
      const secret = process.env.SUPABASE_CHAT_JWT_SECRET?.trim();
      if (!secret) return NextResponse.json({ error: "ORDENS_REALTIME_NOT_CONFIGURED" }, { status: 503, headers });
      const now = Math.floor(Date.now() / 1000);
      const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const body = Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated", iat: now, exp: now + 600 })).toString("base64url");
      const signature = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
      token = `${head}.${body}.${signature}`;
      expiresAt = (now + 600) * 1000;
    }
    return NextResponse.json({ userId, token, expiresAt: new Date(expiresAt).toISOString(), tenantId, topic: `ordens:tenant:${tenantId}` }, { headers });
  } catch (error: unknown) {
    const status = (error as { statusCode?: number })?.statusCode || 500;
    if (status >= 500) console.error("[ordens] realtime token:", error);
    return NextResponse.json({ error: status === 403 ? "FORBIDDEN" : "ORDENS_REALTIME_ERROR" }, { status, headers });
  }
}
