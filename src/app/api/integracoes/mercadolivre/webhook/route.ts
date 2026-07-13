import { NextResponse, type NextRequest } from "next/server";
import { receiveMercadoLivreNotification } from "@/lib/integrations/mercadolivre-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const result = await receiveMercadoLivreNotification(payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    // O Mercado Livre deve receber 200 para não criar uma tempestade de retries.
    // A falha fica persistida e será retomada pela rotina de reconciliação.
    console.error("POST /api/integracoes/mercadolivre/webhook", error);
    return NextResponse.json({ ok: true, queued: true }, { status: 200 });
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: true, service: "mercadolivre-webhook" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
