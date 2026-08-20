import { getClientIp } from "@/lib/login-security";

type TurnstileResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
};

export async function verifyTurnstileToken(token: unknown, request: Request) {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return { configured: false, success: true };

  const responseToken = String(token ?? "").trim();
  if (!responseToken || responseToken.length > 2048) {
    return { configured: true, success: false };
  }

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret,
          response: responseToken,
          remoteip: getClientIp(request),
        }),
        signal: AbortSignal.timeout(5_000),
        cache: "no-store",
      },
    );
    if (!response.ok) return { configured: true, success: false };

    const result = (await response.json()) as TurnstileResponse;
    return { configured: true, success: result.success === true };
  } catch {
    return { configured: true, success: false };
  }
}
