export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserPermissionSet, requireAcompanhamentoAccess } from "@/app/api/_authz/perms";
import { createOperationalEventDetail } from "@/lib/central-operacional/event-detail";

const eventIdSchema = z.string().uuid();

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireAcompanhamentoAccess();

    const { id } = await context.params;
    if (!eventIdSchema.safeParse(id).success) {
      return NextResponse.json(
        { error: "EVENTO_ID_INVALIDO" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const permissions = await getUserPermissionSet();
    const detail = await createOperationalEventDetail(id, Array.from(permissions));

    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    const candidate = error as { statusCode?: number; message?: string };
    const status =
      candidate?.statusCode ??
      (/autenticado/i.test(candidate?.message ?? "")
        ? 401
        : /permiss/i.test(candidate?.message ?? "")
          ? 403
          : 500);
    if (status >= 500) console.error("[central-operacional] evento:", error);
    return NextResponse.json(
      { error: status >= 500 ? "CENTRAL_EVENTO_DETALHE_ERROR" : candidate?.message ?? "FORBIDDEN" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
