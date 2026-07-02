import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getMercadoLivreOrder, refreshMercadoLivreToken, tokenExpiresAt } from "@/lib/integrations/mercadolivre";
import { importMercadoLivreOrder } from "@/lib/integrations/mercadolivre-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MercadoLivreNotification = {
  topic?: string;
  resource?: string;
  user_id?: number;
  application_id?: number;
  attempts?: number;
  sent?: string;
  received?: string;
  [key: string]: unknown;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as MercadoLivreNotification;
    const mlUserId = toNullableNumber(body.user_id);

    const account = mlUserId ? await findAccount(mlUserId) : null;
    const { error } = await supabaseAdmin.from("mercadolivre_notification").insert({
      account_id: account?.id ?? null,
      topic: body.topic ?? null,
      resource: body.resource ?? null,
      ml_user_id: mlUserId,
      application_id: toNullableNumber(body.application_id),
      attempts: toNullableNumber(body.attempts),
      sent: body.sent ?? null,
      received: body.received ?? null,
      raw_payload: body,
    });

    if (error) throw error;

    if (account && body.topic === "orders_v2" && body.resource) {
      const orderId = String(body.resource).split("/").filter(Boolean).pop();
      if (orderId) {
        const accessToken = await ensureAccessToken(account);
        const order = await getMercadoLivreOrder(accessToken, orderId);
        await importMercadoLivreOrder({ ...account, access_token: accessToken }, order);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("POST /api/integracoes/mercadolivre/webhook", e);
    return NextResponse.json({ ok: true, error: e?.message || "Falha ao registrar notificacao." }, { status: 200 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "mercadolivre-webhook" }, { headers: { "Cache-Control": "no-store" } });
}

async function findAccount(mlUserId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, ml_user_id, access_token, refresh_token, expires_at")
    .eq("ml_user_id", mlUserId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

function toNullableNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

async function ensureAccessToken(account: any) {
  const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  const shouldRefresh = Boolean(account.refresh_token && expiresAt && expiresAt - Date.now() < 5 * 60 * 1000);

  if (!shouldRefresh) return account.access_token;

  const token = await refreshMercadoLivreToken(account.refresh_token);
  const { error } = await supabaseAdmin
    .from("mercadolivre_account")
    .update({
      access_token: token.access_token,
      refresh_token: token.refresh_token ?? account.refresh_token,
      token_type: token.token_type ?? null,
      scope: token.scope ?? null,
      expires_at: tokenExpiresAt(token.expires_in),
      raw_token: token,
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);

  if (error) throw error;
  return token.access_token;
}
