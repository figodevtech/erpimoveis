import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { checkLoginRateLimit, registerLoginFailure } from "@/lib/login-rate-limit";
import { buildRecoveryRateLimitKeys } from "@/lib/login-security";

function getRecoveryRedirectUrl(req: NextRequest) {
  const explicitUrl = process.env.SUPABASE_RESET_REDIRECT_URL?.trim();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();

  const rawUrl =
    explicitUrl ||
    (appUrl ? new URL("/recuperar-senha", appUrl).toString() : null) ||
    (process.env.NODE_ENV !== "production"
      ? new URL("/recuperar-senha", req.nextUrl.origin).toString()
      : null);

  if (!rawUrl) {
    throw new Error("RECOVERY_REDIRECT_URL_NOT_CONFIGURED");
  }

  const redirectUrl = new URL(rawUrl);
  const isLocalDevelopment =
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1"].includes(redirectUrl.hostname);

  if (redirectUrl.protocol !== "https:" && !isLocalDevelopment) {
    throw new Error("RECOVERY_REDIRECT_URL_INVALID");
  }

  return redirectUrl.toString();
}

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

    const redirectTo = getRecoveryRedirectUrl(req);
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(value, {
      redirectTo,
    });
    if (error) {
      // A resposta externa permanece idêntica para não revelar contas.
      console.error("[auth/recovery] falha ao solicitar recuperacao:", error.code);
    }

    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error(
      "[auth/recovery] falha interna:",
      error instanceof Error ? error.message : "UNKNOWN_ERROR",
    );
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }
}
