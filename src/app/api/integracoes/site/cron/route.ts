import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { requireEmpresaId } from "@/lib/empresa-context";
import { runStorefrontCatalog } from "@/lib/integrations/storefront-catalog-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET não configurado." }, { status: 503 });
  const received = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  if (Buffer.byteLength(received) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  // O ERP também é instalado em clientes sem loja integrada.
  if (!process.env.STOREFRONT_API_URL?.trim() || !process.env.STOREFRONT_CATALOG_SYNC_SECRET?.trim()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Loja não configurada." });
  }
  try {
    const empresaId = await requireEmpresaId();
    // Uma chamada pode levar 30s; não iniciamos outro lote perto do limite de 60s.
    const result = await runStorefrontCatalog(empresaId, { maxBatches: 3, budgetMs: 20_000 });
    console.info("[site/cron] Catálogo sincronizado", { empresaId, ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[site/cron] Falha ao sincronizar catálogo", error);
    return NextResponse.json({ error: "Falha na sincronização automática. A fila será tentada novamente." }, { status: 500 });
  }
}
