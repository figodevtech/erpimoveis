import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/app/api/_authz/perms";
import { errorStatus } from "@/lib/empresa-context";

export const dynamic = "force-dynamic";
export async function GET() {
  try { await requireAuthenticated(); }
  catch (error) { return NextResponse.json({ error: "Acesso não autorizado." }, { status: errorStatus(error, 401) }); }
  const url = process.env.PLATFORM_API_URL?.trim().replace(/\/$/, "");
  const id = process.env.PLATFORM_INSTALLATION_ID?.trim();
  const secret = process.env.PLATFORM_API_SECRET?.trim();
  if (!url || !id || !secret) return NextResponse.json({ error: "Central não configurada." }, { status: 503 });
  try {
    const response = await fetch(`${url}/api/v1/placas/cota`, {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { "X-Installation-Id": id, Authorization: `Bearer ${secret}` },
    });
    if (!response.ok) throw new Error("quota_unavailable");
    return NextResponse.json(await response.json(), { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Não foi possível carregar a cota da Central." }, { status: 503 }); }
}
