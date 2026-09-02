export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { checkLoginRateLimit, clearLoginRateLimit, registerLoginFailure } from "@/lib/login-rate-limit";
import { buildChecklistSigningRateLimitKeys } from "@/lib/login-security";
import { checklistRequestAudit } from "@/lib/ordens/checklist-request";
import {
  authenticateChecklistSigningInvitation,
  CHECKLIST_SIGNING_SESSION_COOKIE,
  CHECKLIST_SIGNING_SESSION_SECONDS,
  resolveChecklistSigningInvitation,
} from "@/lib/ordens/checklist-signing-server";
import { validateChecklistSigningOrigin } from "@/lib/ordens/checklist-signing-security";

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const GENERIC_ERROR = "CPF, senha ou convite inválidos.";

function denied(status = 403, retryAfter?: number) {
  return NextResponse.json({ error: status === 429 ? "Muitas tentativas. Tente novamente mais tarde." : GENERIC_ERROR }, {
    status,
    headers: { ...HEADERS, ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) },
  });
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    if (!validateChecklistSigningOrigin(request)) return denied();
    const { token } = await context.params;
    const invitation = await resolveChecklistSigningInvitation(token);
    const keys = buildChecklistSigningRateLimitKeys(invitation?.row.public_id ?? "invalid", request);
    const retryAfter = await checkLoginRateLimit(keys);
    if (retryAfter > 0) return denied(429, retryAfter);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!invitation) {
      const blockedFor = await registerLoginFailure(keys);
      return blockedFor > 0 ? denied(429, blockedFor) : denied();
    }
    const session = await authenticateChecklistSigningInvitation({
      invitation,
      cpf: body?.cpf,
      password: body?.senha,
      audit: checklistRequestAudit(request),
    });
    if (!session) {
      const blockedFor = await registerLoginFailure(keys);
      return blockedFor > 0 ? denied(429, blockedFor) : denied();
    }
    await clearLoginRateLimit([keys[0]]);
    const response = NextResponse.json({ autenticado: true }, { headers: HEADERS });
    response.cookies.set(CHECKLIST_SIGNING_SESSION_COOKIE, session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: CHECKLIST_SIGNING_SESSION_SECONDS,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Não foi possível validar o acesso." }, { status: 500, headers: HEADERS });
  }
}
