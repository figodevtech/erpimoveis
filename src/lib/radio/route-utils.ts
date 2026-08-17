import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { SafeHttpError } from "./safe-http";

export function radioJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function getRadioContext() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    const error = new Error("Nao autenticado.");
    (error as any).statusCode = 401;
    throw error;
  }
  return { userId, companyId: await requireEmpresaId() };
}

export function radioErrorResponse(route: string, error: unknown) {
  if (error instanceof ZodError) {
    return radioJson(
      { error: "Dados invalidos.", details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) },
      400,
    );
  }

  const status = errorStatus(error, 500);
  const message = error instanceof Error ? error.message : "Falha interna no modulo de radios.";
  if (error instanceof SafeHttpError && error.code === "UNSAFE_URL") {
    console.warn(`[radios] SSRF bloqueado em ${route}: ${error.code}`);
  } else if (status >= 500) {
    console.error(`[radios] ${route}`, error);
  } else if (error instanceof SafeHttpError) {
    console.info(`[radios] ${route}: ${error.code}`);
  }
  return radioJson({ error: message }, status);
}
