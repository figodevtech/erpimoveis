import { NextRequest, NextResponse } from "next/server";
import { receiveMercadoLivreNotification } from "@/lib/integrations/mercadolivre-notifications";
import { verifyMercadoLivrePlatformDelivery } from "@/lib/integrations/mercadolivre-platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const authorized = verifyMercadoLivrePlatformDelivery({
    body,
    timestamp: request.headers.get("x-platform-timestamp"),
    signature: request.headers.get("x-platform-signature"),
    installationId: request.headers.get("x-installation-id"),
  });
  if (!authorized) return NextResponse.json({ error: "Entrega não autorizada." }, { status: 401 });

  try {
    const payload = JSON.parse(body);
    const result = await receiveMercadoLivreNotification(payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (cause) {
    console.error("POST /api/integracoes/mercadolivre/webhook/platform", cause);
    return NextResponse.json({ error: "Falha ao registrar notificação Mercado Livre." }, { status: 503 });
  }
}
