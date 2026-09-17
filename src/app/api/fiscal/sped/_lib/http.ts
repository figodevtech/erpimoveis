import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { SpedServiceError } from "@/services/fiscal/sped";

export async function requireSpedActor(): Promise<string> {
  const session = await auth();
  const actorId = (session?.user as { id?: string } | undefined)?.id;
  if (!actorId) throw new SpedServiceError("Não autenticado.", 401, "UNAUTHENTICATED");
  return actorId;
}

export function spedErrorResponse(error: unknown) {
  const status = error instanceof SpedServiceError
    ? error.statusCode
    : Number((error as { statusCode?: unknown } | null)?.statusCode) || 500;
  const code = error instanceof SpedServiceError ? error.code : "INTERNAL_ERROR";
  const message = error instanceof Error ? error.message : "Falha ao processar o SPED Fiscal.";
  if (status >= 500) console.error("[api/fiscal/sped]", error);
  return NextResponse.json({ error: code, message }, { status });
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SpedServiceError("Corpo JSON inválido.", 400, "INVALID_JSON");
  }
  return body as Record<string, unknown>;
}
