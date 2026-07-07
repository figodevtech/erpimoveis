import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getMercadoLivreOrder, refreshMercadoLivreToken, tokenExpiresAt } from "@/lib/integrations/mercadolivre";
import { importMercadoLivreOrder } from "@/lib/integrations/mercadolivre-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MERCADO_PAGO_API_BASE_URL = "https://api.mercadopago.com";

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

    if (account && isClaimTopic(body.topic) && body.resource) {
      await processClaimNotification(account, body.resource).catch((error) => {
        console.warn("Falha ao pré-processar reclamação Mercado Livre", error);
      });
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

function isClaimTopic(topic?: string) {
  const value = String(topic ?? "").toLowerCase();
  return value.includes("claim") || value.includes("reclama");
}

async function processClaimNotification(account: any, resource: string) {
  const claimId = String(resource).split("/").filter(Boolean).pop();
  if (!claimId) return;

  const accessToken = await ensureAccessToken(account);
  const claim = await mercadoPagoApiGet(accessToken, `/post-purchase/v1/claims/${encodeURIComponent(claimId)}`);
  const order = await findRelatedOrder(account.empresa_id, claim);
  if (!order) return;

  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin.from("mercadolivre_claim").upsert(
    {
      empresa_id: account.empresa_id,
      account_id: account.id,
      order_id: order.id,
      ml_order_id: order.ml_order_id,
      ml_shipment_id: order.ml_shipment_id ?? null,
      ml_claim_id: String(claim?.id ?? claimId),
      status: claim?.status ?? claim?.stage ?? null,
      stage: claim?.stage ?? null,
      claim_type: claim?.type ?? claim?.reason?.type ?? null,
      reason: claim?.reason?.name ?? claim?.reason?.description ?? claim?.reason_id ?? null,
      title: claim?.title ?? claim?.reason?.name ?? "Reclamação Mercado Livre",
      due_date: claim?.due_date ?? claim?.expiration_date ?? claim?.deadline ?? null,
      closed_at: claim?.closed_at ?? claim?.date_closed ?? (String(claim?.status ?? "").toLowerCase() === "closed" ? claim?.last_updated : null) ?? null,
      resolution: getClaimResolution(claim),
      available_actions: getClaimAvailableActions(claim),
      players: Array.isArray(claim?.players) ? claim.players : [],
      resource,
      raw_claim: claim ?? {},
      synced_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "ml_claim_id" },
  );

  if (error) throw error;
}

function getClaimResolution(claim: any) {
  const resolution = claim?.resolution ?? claim?.resolved_by ?? claim?.expected_resolution ?? null;
  if (!resolution) return null;
  if (typeof resolution === "string") return resolution;
  return (
    resolution?.type ??
    resolution?.status ??
    resolution?.decision ??
    resolution?.expected_resolution ??
    resolution?.reason ??
    null
  );
}

function getClaimAvailableActions(claim: any) {
  if (Array.isArray(claim?.available_actions)) return claim.available_actions;
  if (Array.isArray(claim?.actions)) return claim.actions;
  if (Array.isArray(claim?.available_resolutions)) return claim.available_resolutions;
  return [];
}

async function findRelatedOrder(empresaId: number, claim: any) {
  const raw = JSON.stringify(claim ?? {});
  const resourceId = Number(claim?.resource_id ?? claim?.resource?.id ?? 0);

  const { data, error } = await supabaseAdmin
    .from("mercadolivre_order")
    .select("id, ml_order_id, ml_shipment_id")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  const orders = data ?? [];
  return (
    orders.find((order: any) => Number(order.ml_shipment_id ?? 0) > 0 && Number(order.ml_shipment_id) === resourceId) ??
    orders.find((order: any) => Number(order.ml_order_id) === resourceId) ??
    orders.find((order: any) => raw.includes(String(order.ml_order_id))) ??
    null
  );
}

async function mercadoPagoApiGet(accessToken: string, path: string) {
  const response = await fetch(`${MERCADO_PAGO_API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mercado Pago ${path} falhou (${response.status}): ${text}`);
  }

  return response.json();
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
