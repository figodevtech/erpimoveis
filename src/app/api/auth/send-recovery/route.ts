import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { checkLoginRateLimit, registerLoginFailure } from "@/lib/login-rate-limit";
import { buildRecoveryRateLimitKeys } from "@/lib/login-security";

export async function POST(req: NextRequest) {
  try {
    const { email } = (await req.json()) as { email?: string };
    const value = (email || "").trim().toLowerCase();
    if (!value || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });

    const rateLimitKeys = buildRecoveryRateLimitKeys(value, req);
    const retryAfter = await checkLoginRateLimit(rateLimitKeys);
    if (retryAfter > 0) {
      return NextResponse.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) } },
      );
    }

    const blockedFor = await registerLoginFailure(rateLimitKeys);
    if (blockedFor > 0) {
      return NextResponse.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store", "Retry-After": String(blockedFor) } },
      );
    }

    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(value);
    if (error) {
      // A resposta externa permanece idêntica para não revelar contas.
      console.error("[auth/recovery] falha ao solicitar recuperacao:", error.code);
    }

    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }
}
