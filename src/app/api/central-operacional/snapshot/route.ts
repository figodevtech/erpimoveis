export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { getUserPermissionSet, requireAcompanhamentoAccess } from "@/app/api/_authz/perms";
import { allowedOperationalModules } from "@/lib/central-operacional/permissions";
import { operationalPeriodSchema } from "@/lib/central-operacional/contracts";
import { createOperationalSnapshot } from "@/lib/central-operacional/snapshot";

export async function GET(request: Request) {
  try {
    await requireAcompanhamentoAccess();
    const periodResult = operationalPeriodSchema.safeParse(
      new URL(request.url).searchParams.get("periodo") ?? "DIARIO",
    );
    if (!periodResult.success) {
      return NextResponse.json(
        { error: "PERIODO_INVALIDO" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const permissions = await getUserPermissionSet();
    const modules = allowedOperationalModules(Array.from(permissions));
    const snapshot = await createOperationalSnapshot(modules, periodResult.data);
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    const candidate = error as { statusCode?: number; message?: string };
    const status = candidate?.statusCode ?? (/autenticado/i.test(candidate?.message ?? "") ? 401 : /permiss/i.test(candidate?.message ?? "") ? 403 : 500);
    if (status >= 500) console.error("[central-operacional] snapshot:", error);
    return NextResponse.json(
      { error: status >= 500 ? "CENTRAL_SNAPSHOT_ERROR" : candidate?.message ?? "FORBIDDEN" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
