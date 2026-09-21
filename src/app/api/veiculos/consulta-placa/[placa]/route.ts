import { NextResponse } from "next/server";
import { requireAuthenticated, requireAny, PERMS } from "@/app/api/_authz/perms";
import { errorStatus } from "@/lib/empresa-context";
import { reportErpDiagnostic } from "@/lib/monitoring/erp-diagnostic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizarPlaca(valor: string) {
  return valor.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ placa: string }> }
) {
  const diagnosticStartedAt = Date.now();
  try {
    await requireAuthenticated();
    await requireAny([PERMS.VEICULOS_CRIAR, PERMS.VEICULOS_EDITAR, PERMS.DESMANCHE_CRIAR, PERMS.DESMANCHE_EDITAR]);
  } catch (error) {
    return NextResponse.json({ error: "Acesso não autorizado para consultar placas." }, { status: errorStatus(error, 401) });
  }
  const { placa } = await ctx.params;
  const placaNormalizada = normalizarPlaca(placa || "");

  if (!placaNormalizada) {
    return NextResponse.json(
      { error: "Placa nao informada" },
      { status: 400 }
    );
  }

  if (!/^[A-Z]{3}(?:[0-9]{4}|[0-9][A-Z][0-9]{2})$/.test(placaNormalizada)) {
    return NextResponse.json(
      { error: "Placa invalida. Use o formato AAA0X00 ou AAA9999." },
      { status: 400 }
    );
  }

  const centralUrl = process.env.PLATFORM_API_URL?.trim().replace(/\/$/, "");
  const installationId = process.env.PLATFORM_INSTALLATION_ID?.trim();
  const secret = process.env.PLATFORM_API_SECRET?.trim();

  if (!centralUrl || !installationId || !secret) {
    return NextResponse.json(
      { error: "Configure a conexao desta instalacao com a Central para consultar placas" },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(`${centralUrl}/api/v1/placas/consulta`, {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json", "X-Installation-Id": installationId, Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ placa: placaNormalizada, requestId: crypto.randomUUID() }),
    });
    const data = await response.json();
    if (!response.ok) return NextResponse.json({ error: typeof data?.error === "string" ? data.error : "Falha na consulta da Central.", limiteConsultasPlaca: data?.limiteConsultasPlaca }, { status: response.status, headers: { "Cache-Control": "no-store" } });

    return NextResponse.json(
      data,
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    reportErpDiagnostic("/api/veiculos/consulta-placa/[placa]", "QUERY_PLATE_CENTRAL", diagnosticStartedAt, error);
    return NextResponse.json({ error: "Nao foi possivel consultar a placa na Central." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
