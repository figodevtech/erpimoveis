import { after, NextResponse, type NextRequest } from "next/server";
import { receiveMercadoLivreNotification, retryMercadoLivreNotifications } from "@/lib/integrations/mercadolivre-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const result = await receiveMercadoLivreNotification(payload);
    if (result.queued) {
      after(async () => {
        try {
          await retryMercadoLivreNotifications(10);
        } catch (error) {
          console.error("Falha ao processar imediatamente a fila do webhook Mercado Livre", error);
        }
      });
    }
    return NextResponse.json(
      { ok: true, ...result },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    console.error("POST /api/integracoes/mercadolivre/webhook", error);
    // Sem persistência, não confirmamos o recebimento para que o Mercado Livre reenvie o evento.
    return NextResponse.json(
      { ok: false, queued: false, error: "Não foi possível registrar a notificação." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: true, service: "mercadolivre-webhook" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
