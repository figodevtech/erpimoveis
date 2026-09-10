import { after, NextResponse, type NextRequest } from "next/server";
import { receiveMercadoLivreNotification, retryMercadoLivreNotifications } from "@/lib/integrations/mercadolivre-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// O Mercado Livre entrega notificações pequenas; um corpo maior que isto não é
// evento legítimo. A rota é pública — sem assinatura, qualquer POST chega aqui.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_EVENTS_PER_MINUTE = 240;
const recentDeliveries = new Map<string, { count: number; resetAt: number }>();

function withinRateLimit(mlUserId: unknown) {
  const key = String(mlUserId ?? "desconhecido");
  const now = Date.now();
  const window = recentDeliveries.get(key);
  if (!window || now >= window.resetAt) {
    recentDeliveries.set(key, { count: 1, resetAt: now + 60_000 });
    // A instância é efêmera e o mapa é pequeno, mas sem esta poda um vendedor
    // diferente a cada minuto faria o processo crescer sem parar.
    if (recentDeliveries.size > 1000) {
      for (const [id, entry] of recentDeliveries) if (now >= entry.resetAt) recentDeliveries.delete(id);
    }
    return true;
  }
  window.count += 1;
  return window.count <= MAX_EVENTS_PER_MINUTE;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json(
        { ok: false, queued: false, error: "Notificação acima do tamanho aceito." },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }
    const payload = JSON.parse(body);
    if (!withinRateLimit(payload?.user_id)) {
      // 429 faz o Mercado Livre reenviar mais tarde, sem perder o evento.
      return NextResponse.json(
        { ok: false, queued: false, error: "Muitas notificações em sequência." },
        { status: 429, headers: { "Cache-Control": "no-store" } },
      );
    }
    const result = await receiveMercadoLivreNotification(payload, "DIRETO");
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
